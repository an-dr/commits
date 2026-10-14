use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bones_kernel::bus::{Bus, Envelope, Handler, Module, ModuleContext};
use bones_kernel::logging::Logger;
use bones_kernel::watch::Watcher as RecommendedWatcher;
use commits_ipc::native::{WatchEvent, WatchRequest};

pub const REQUEST_TOPIC: &str = "watcher/request";
pub const FULL_TOPIC: &str = "repo/full-refresh";
pub const LIGHTWEIGHT_TOPIC: &str = "repo/lightweight-refresh";

/// How long the tree must be quiet before a burst is reported as one event.
/// One `git commit` writes the index, several refs, a reflog and its objects;
/// reporting each separately would refresh the graph a dozen times over.
const QUIET_PERIOD: Duration = Duration::from_millis(150);

/// Directory names whose churn never changes what the app displays. A build
/// writing thousands of files under `target/` must not reach the guest at all,
/// which is the difference between an idle app and one refreshing continuously.
const IGNORED_DIRECTORIES: [&str; 5] = ["target", "node_modules", "dist", ".tools", ".venv"];

/// Whether a changed path is worth telling the guest about.
///
/// `.git/objects` is excluded for the same reason as a build directory: writing
/// a commit's objects says nothing the refs it then updates will not say, and a
/// large fetch writes a great many of them.
pub fn is_interesting(path: &Path) -> bool {
    let mut components = path.components().map(|c| c.as_os_str().to_string_lossy());
    let mut previous_was_git_dir = false;
    for component in &mut components {
        if IGNORED_DIRECTORIES.contains(&component.as_ref()) {
            return false;
        }
        if previous_was_git_dir && (component == "objects" || component == "lfs") {
            return false;
        }
        previous_was_git_dir = component == ".git";
    }
    true
}

/// Whether a path inside a repository's metadata is a lock a running Git
/// command is holding rather than a change to the repository.
///
/// Git writes `<file>.lock`, fills it, and renames it over `<file>`, so the
/// lock's creation and removal say nothing the change to the file it guards
/// will not say a moment later. Ignoring them is what keeps the app from
/// refreshing in response to its own reads: `git status` in a repository with
/// submodules takes `index.lock` in each submodule's Git directory even when
/// it goes on to write nothing, and reporting that produced a refresh, whose
/// `git status` produced another lock, without end (BUG-004).
///
/// Only inside the Git directory: a `.lock` in a working tree is an ordinary
/// file -- `Cargo.lock` is the obvious one -- and changing it is a real edit.
pub fn is_metadata_lock(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension == "lock")
}

pub struct WatcherModule {
    bus: Option<Bus>,
    /// Filled by the registering thread rather than by `start`, so the engine
    /// is never inside `notify::Watcher::watch` (see `start`).
    watchers: Arc<Mutex<HashMap<u32, RecommendedWatcher>>>,
    /// Watches stopped before their registration finished. The registering
    /// thread drops such a watcher instead of installing one nobody wants.
    stopped: Arc<Mutex<HashSet<u32>>>,
    logger: Option<Logger>,
}

impl WatcherModule {
    pub fn new() -> Self {
        Self {
            bus: None,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            stopped: Arc::new(Mutex::new(HashSet::new())),
            logger: None,
        }
    }

    /// Whether the watch is registered and live. Registration is asynchronous,
    /// so this is how a caller -- a test, in practice -- knows the tree is
    /// actually being watched rather than about to be.
    pub fn is_watching(&self, request_id: u32) -> bool {
        self.watchers.lock().unwrap().contains_key(&request_id)
    }

    pub fn with_logger(mut self, logger: Logger) -> Self {
        self.logger = Some(logger);
        self
    }

    /// Registers a recursive watch, off the engine's thread.
    ///
    /// `notify`'s recursive watch adds one inotify watch per directory, which
    /// means walking the whole tree: 1.7 seconds for a mid-sized repository
    /// with a warm cache and far longer with a cold one. Doing that inside
    /// `handle` froze the engine -- no frames, no window, no messages
    /// delivered -- for as long as it took, which is what made opening a
    /// repository look like a hang.
    fn start(&mut self, request: WatchRequest) -> Result<(), String> {
        let bus = self.bus.clone().ok_or("no Bus service available")?;
        let watchers = Arc::clone(&self.watchers);
        let stopped = Arc::clone(&self.stopped);
        let logger = self.logger.clone();
        std::thread::Builder::new()
            .name("commits-watch-registration".to_string())
            .spawn(move || {
                let request_id = request.request_id;
                match register(bus, request, logger.as_ref()) {
                    // A stop that arrived first wins: install nothing, and
                    // drop the watcher here rather than leaving a tree
                    // watched that nobody asked about any more.
                    Ok(watcher) => {
                        let removed = {
                            let mut stopped = stopped.lock().unwrap();
                            if stopped.remove(&request_id) {
                                Some(watcher)
                            } else {
                                watchers.lock().unwrap().insert(request_id, watcher)
                            }
                        };
                        // Dropping notify may join its worker; release both state
                        // locks first, including when replacing an existing watch.
                        drop(removed);
                    }
                    Err(reason) => {
                        // Nothing was installed, so a stop waiting for this
                        // registration has nothing left to cancel: leaving
                        // the id behind would keep it forever.
                        stopped.lock().unwrap().remove(&request_id);
                        if let Some(logger) = &logger {
                            logger.error("watcher", &format!("watching failed: {reason}"));
                        }
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

/// Notify reports the watched spelling while Windows canonicalization can
/// change its case and add verbatim prefixes. Compare one spelling, including
/// UNC metadata roots, without changing case-sensitive paths on other systems.
fn comparable_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let text = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
    };
    #[cfg(windows)]
    let text = text.to_lowercase();
    PathBuf::from(text)
}

fn register(
    bus: Bus,
    request: WatchRequest,
    logger: Option<&Logger>,
) -> Result<RecommendedWatcher, String> {
    // Register the same resolved spelling used for metadata roots. Otherwise
    // junctions and Windows short paths make their events look like worktree edits.
    let repository =
        std::fs::canonicalize(&request.repository).map_err(|error| error.to_string())?;
    let metadata = resolve_metadata_paths(&repository)?;
    let request_id = request.request_id;
    let repository_text = request.repository.clone();
    let metadata_for_events: Vec<_> = metadata.iter().map(|path| comparable_path(path)).collect();
    let mut watcher = RecommendedWatcher::new(QUIET_PERIOD, move |_, change| {
        let paths: Vec<_> = change
            .paths
            .iter()
            .filter(|path| is_interesting(path))
            .filter(|path| {
                let comparable = comparable_path(path);
                let is_metadata = metadata_for_events
                    .iter()
                    .any(|root| comparable.starts_with(root));
                // A lock also changes its parent directory's mtime. Metadata
                // files report their own mutations; the live root adds none.
                !is_metadata
                    || (!is_metadata_lock(path)
                        && !(path.is_dir() && metadata_for_events.contains(&comparable)))
            })
            .collect();
        let Some(path) = paths.first() else {
            return;
        };
        let full = paths.iter().any(|path| {
            metadata_for_events
                .iter()
                .any(|root| comparable_path(path).starts_with(root))
        });
        let message = WatchEvent {
            request_id,
            kind: u8::from(!full),
            repository: repository_text.clone(),
            path: path.to_string_lossy().into_owned(),
        };
        if let Ok(payload) = message.encode() {
            bus.publish(Envelope {
                topic: if full { FULL_TOPIC } else { LIGHTWEIGHT_TOPIC }.into(),
                sender: "watcher".into(),
                correlation: Some(u64::from(request_id)),
                payload,
            });
        }
    })?;
    let started = std::time::Instant::now();
    watcher
        .watch(&repository, true)
        .map_err(|error| error.to_string())?;
    if let Some(logger) = logger {
        logger.info(
            "watcher",
            &format!(
                "watching {} took {}ms",
                repository.display(),
                started.elapsed().as_millis()
            ),
        );
    }
    for path in metadata {
        if !comparable_path(&path).starts_with(comparable_path(&repository)) {
            watcher
                .watch(&path, true)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(watcher)
}

impl Default for WatcherModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Handler for WatcherModule {
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic != REQUEST_TOPIC {
            return;
        }
        let Ok(request) = WatchRequest::decode(&envelope.payload) else {
            return;
        };
        if request.action == 0 {
            let _ = self.start(request);
        } else {
            // Use the registration thread's lock order and keep the decision atomic.
            let mut stopped = self.stopped.lock().unwrap();
            let removed = self.watchers.lock().unwrap().remove(&request.request_id);
            if removed.is_none() {
                stopped.insert(request.request_id);
            }
            drop(stopped);
            drop(removed);
        }
    }
}

impl Module for WatcherModule {
    fn name(&self) -> &str {
        "watcher"
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REQUEST_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.bus
            .as_ref()
            .map(|_| ())
            .ok_or_else(|| "no Bus service available".into())
    }
}

pub fn resolve_metadata_paths(repository: &Path) -> Result<Vec<PathBuf>, String> {
    let dot_git = repository.join(".git");
    let git_dir = if dot_git.is_dir() {
        dot_git
    } else {
        let text = std::fs::read_to_string(&dot_git).map_err(|error| error.to_string())?;
        let value = text
            .strip_prefix("gitdir:")
            .map(str::trim)
            .ok_or("invalid .git file")?;
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            repository.join(path)
        }
    };
    let git_dir = std::fs::canonicalize(&git_dir).map_err(|error| error.to_string())?;
    let mut paths = vec![git_dir.clone()];
    if let Ok(value) = std::fs::read_to_string(git_dir.join("commondir")) {
        let path = PathBuf::from(value.trim());
        let common = if path.is_absolute() {
            path
        } else {
            git_dir.join(path)
        };
        paths.push(std::fs::canonicalize(common).map_err(|error| error.to_string())?);
    }
    Ok(paths)
}

#[cfg(test)]
mod tests;
