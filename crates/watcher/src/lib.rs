use std::collections::HashMap;
use std::path::{Path, PathBuf};

use bus::{Bus, Envelope, Handler, Module, ModuleContext};
use commits_ipc::native::{WatchEvent, WatchRequest};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};

pub const REQUEST_TOPIC: &str = "watcher/request";
pub const FULL_TOPIC: &str = "repo/full-refresh";
pub const LIGHTWEIGHT_TOPIC: &str = "repo/lightweight-refresh";

pub struct WatcherModule {
    bus: Option<Bus>,
    watchers: HashMap<u32, RecommendedWatcher>,
}

impl WatcherModule {
    pub fn new() -> Self {
        Self {
            bus: None,
            watchers: HashMap::new(),
        }
    }

    fn start(&mut self, request: WatchRequest) -> Result<(), String> {
        let bus = self.bus.clone().ok_or("no Bus service available")?;
        let repository = PathBuf::from(&request.repository);
        let metadata = resolve_metadata_paths(&repository)?;
        let request_id = request.request_id;
        let repository_text = request.repository.clone();
        let metadata_for_events = metadata.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else { return };
                for path in event.paths {
                    let full = metadata_for_events
                        .iter()
                        .any(|root| path.starts_with(root));
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
                }
            })
            .map_err(|error| error.to_string())?;
        watcher
            .watch(&repository, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
        for path in metadata {
            if !path.starts_with(&repository) {
                watcher
                    .watch(&path, RecursiveMode::Recursive)
                    .map_err(|error| error.to_string())?;
            }
        }
        self.watchers.insert(request_id, watcher);
        Ok(())
    }
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
            self.watchers.remove(&request.request_id);
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
