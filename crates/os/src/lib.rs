//! The `repo-os` module: the OS actions that need a repository.
//!
//! The generic desktop surface -- clipboard, browser, file pickers, HTTPS
//! fetch -- is the engine's `os` module, on `os/*`. What is left here is what
//! no other host could use: reading a file confined to one repository,
//! scanning a folder for repositories, and launching a configured diff or
//! merge tool against one.
//!
//! The two are separate endpoints rather than one with a wider vocabulary,
//! because an action space shared between a generic module and an application
//! one has to leave gaps for both. Each numbers its actions from zero and
//! answers on its own result topic; a caller pairs answers to questions by
//! request id and does not care which endpoint replied.
//!
//! Also here: `rendezvous`, the file-backed handshake `GIT_ASKPASS` and
//! `GIT_EDITOR` helpers use to reach a running app, and `discover`, the
//! repository scan.

use base64::Engine;
use std::collections::HashSet;
use std::sync::Arc;
use std::thread;

use bones_engine::bus::{Bus, Envelope, Handler, Module, ModuleContext};
use commits_ipc::native::{NativeResult, OsRequest};

pub mod discover;
pub mod rendezvous;

/// This module's topics. The generic desktop actions -- clipboard, urls,
/// pickers, fetch -- are the engine's `os` module's, on `os/*`; what is left
/// here needs a repository, which no other host has.
pub const REPO_REQUEST_TOPIC: &str = "repo-os/request";
pub const REPO_RESULT_TOPIC: &str = "repo-os/result";
pub const PROMPT_TOPIC: &str = "os/prompt";
pub const PROMPT_RESPONSE_TOPIC: &str = "os/prompt-response";

/// Largest working-tree file the page is served. Beyond this the view would be
/// unusable anyway, and the text crosses the panel boundary as one string.
pub const MAX_FILE_READ_BYTES: u64 = 4 * 1024 * 1024;

/// The git-aware half, which the engine's generic OS surface has no business
/// knowing about: every action here needs a repository to mean anything.
pub trait RepoOsBackend: Send + Sync {
    /// Reads a text file inside one repository.
    ///
    /// `request` carries the repository and the path, separated by a newline.
    /// A file that is missing, binary, or larger than [`MAX_FILE_READ_BYTES`]
    /// is reported as absent rather than as an error: not being readable is a
    /// normal outcome for a working-tree entry.
    fn read_file(&self, request: &str) -> Result<Option<String>, String>;
    /// Lists every git repository at or below one folder, newline-separated,
    /// with the folder itself first when it is one. A folder holding no
    /// repository at all is reported as absent rather than as an error: it is
    /// a normal answer to "what is in here".
    fn find_repositories(&self, path: &str) -> Result<Option<String>, String>;
    /// Runs one external tool the user has configured.
    ///
    /// `request` is the line-framed form [`parse_tool_run`] reads: the
    /// program, the two optional diff files, and then the argument vector.
    /// The tool is started and left to run on its own -- the app does not wait
    /// for an editor the user may keep open for hours.
    fn run_tool(&self, request: &str) -> Result<(), String>;
}

pub struct SystemOsBackend;

impl RepoOsBackend for SystemOsBackend {
    fn read_file(&self, request: &str) -> Result<Option<String>, String> {
        let (repository, path) = request
            .split_once('\n')
            .ok_or_else(|| String::from("a file read names a repository and a path"))?;
        read_repository_file(std::path::Path::new(repository), path)
    }
    fn run_tool(&self, request: &str) -> Result<(), String> {
        let run = parse_tool_run(request)?;
        let args = materialize_tool_args(&run, &std::env::temp_dir())?;
        std::process::Command::new(&run.program)
            .args(&args)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("could not start {}: {error}", run.program))
    }
    fn find_repositories(&self, path: &str) -> Result<Option<String>, String> {
        let found = discover::find_repositories(std::path::Path::new(path));
        if found.is_empty() {
            return Ok(None);
        }
        Ok(Some(
            found
                .iter()
                .map(|repository| repository.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("\n"),
        ))
    }
}

/// One side of a diff a tool is about to be handed.
#[derive(Debug, PartialEq, Eq)]
pub struct ToolBlob {
    pub name: String,
    pub base64: String,
}

/// A parsed `run-tool` request: what to start, and what to hand it.
#[derive(Debug, PartialEq, Eq)]
pub struct ToolRun {
    pub program: String,
    pub args: Vec<String>,
    pub left: Option<ToolBlob>,
    pub right: Option<ToolBlob>,
}

/// Reads the line-framed `run-tool` value.
///
/// The framing is the program, the left file's name and contents, the right
/// file's name and contents, then one argument per line. It is positional
/// rather than keyed because the fields are fixed and the value crosses the
/// component boundary as a single string; the page's `encodeToolRun` writes
/// the same order.
pub fn parse_tool_run(value: &str) -> Result<ToolRun, String> {
    let mut lines = value.split('\n');
    let program = lines
        .next()
        .filter(|program| !program.is_empty())
        .ok_or_else(|| String::from("a tool run names no program"))?
        .to_string();
    let mut field = || lines.next().unwrap_or_default().to_string();
    let left_name = field();
    let left_base64 = field();
    let right_name = field();
    let right_base64 = field();
    let blob = |name: String, base64: String| {
        (!name.is_empty()).then_some(ToolBlob { name, base64 })
    };
    Ok(ToolRun {
        program,
        args: lines.map(|argument| argument.to_string()).collect(),
        left: blob(left_name, left_base64),
        right: blob(right_name, right_base64),
    })
}

/// Strips everything but the file name, so a crafted name cannot place the
/// temporary file outside the directory chosen for it.
fn temp_file_name(name: &str) -> String {
    let stripped = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim_matches(|character: char| character == '.' || character.is_whitespace());
    if stripped.is_empty() {
        String::from("file")
    } else {
        stripped.to_string()
    }
}

/// Writes the diff sides into `directory` and substitutes their paths for the
/// `{left}` and `{right}` placeholders, returning the arguments to run with.
///
/// A run with no diff sides -- opening a repository, say -- writes nothing and
/// returns its arguments unchanged.
pub fn materialize_tool_args(
    run: &ToolRun,
    directory: &std::path::Path,
) -> Result<Vec<String>, String> {
    let mut left_path = String::new();
    let mut right_path = String::new();
    if run.left.is_some() || run.right.is_some() {
        // One directory per run: two revisions of the same file usually share a
        // name, so they cannot both sit directly in the system temp directory.
        let unique = format!(
            "commits-diff-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        );
        for (blob, slot, side) in [
            (run.left.as_ref(), &mut left_path, "left"),
            (run.right.as_ref(), &mut right_path, "right"),
        ] {
            let Some(blob) = blob else { continue };
            let folder = directory.join(&unique).join(side);
            std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&blob.base64)
                .map_err(|error| format!("{side} side is not valid base64: {error}"))?;
            let path = folder.join(temp_file_name(&blob.name));
            std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
            *slot = path.to_string_lossy().into_owned();
        }
    }
    Ok(run
        .args
        .iter()
        .map(|argument| argument.replace("{left}", &left_path).replace("{right}", &right_path))
        .collect())
}

/// Reads `path` only when it resolves inside `repository`.
///
/// The path arrives over the page boundary, so containment is checked against
/// the canonical repository rather than trusted; a path escaping it is an error,
/// while an unreadable file inside it is simply absent.
fn read_repository_file(
    repository: &std::path::Path,
    path: &str,
) -> Result<Option<String>, String> {
    let root = repository
        .canonicalize()
        .map_err(|error| format!("repository is unavailable: {error}"))?;
    let Ok(target) = root.join(path).canonicalize() else {
        return Ok(None);
    };
    if !target.starts_with(&root) {
        return Err("a file read may not leave its repository".into());
    }
    let Ok(metadata) = std::fs::metadata(&target) else {
        return Ok(None);
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_READ_BYTES {
        return Ok(None);
    }
    // Invalid UTF-8 means the file is not text the panel can show, which is the
    // same outcome as a file it cannot read.
    Ok(std::fs::read(&target).ok().and_then(|bytes| String::from_utf8(bytes).ok()))
}

pub struct OsModule {
    bus: Option<Bus>,
    repo_backend: Arc<dyn RepoOsBackend>,
    /// Prompts already announced. A waiting `commits-askpass` leaves its
    /// request file in place until it is answered, and this frame runs at
    /// frame rate: without this the same question was republished sixty
    /// times a second for the two minutes askpass waits.
    announced: HashSet<String>,
}

impl OsModule {
    pub fn new(repo_backend: Arc<dyn RepoOsBackend>) -> Self {
        Self {
            bus: None,
            repo_backend,
            announced: HashSet::new(),
        }
    }

    /// Runs one request off the bus thread.
    ///
    /// A repository scan walks a directory tree and an external tool is
    /// spawned; neither may stall the engine, so the answer arrives when the
    /// work finishes, paired by request id.
    fn start(&self, request: OsRequest) {
        let Some(bus) = self.bus.clone() else { return };
        let repo_backend = self.repo_backend.clone();
        thread::spawn(move || {
            let result = execute_repo(repo_backend.as_ref(), &request);
            if let Ok(payload) = result.encode() {
                bus.publish(Envelope {
                    topic: REPO_RESULT_TOPIC.into(),
                    sender: "repo-os".into(),
                    correlation: Some(u64::from(request.request_id)),
                    payload,
                });
            }
        });
    }
}

impl Default for OsModule {
    fn default() -> Self {
        Self::new(Arc::new(SystemOsBackend))
    }
}

impl Handler for OsModule {
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic == REPO_REQUEST_TOPIC {
            if let Ok(request) = OsRequest::decode_repo(&envelope.payload) {
                self.start(request);
            }
        } else if envelope.topic == PROMPT_RESPONSE_TOPIC {
            if let Ok(text) = std::str::from_utf8(&envelope.payload) {
                if let Some((id, value)) = text.split_once('\n') {
                    let _ = rendezvous::reply(&prompt_directory(), id, value);
                }
            }
        }
    }
}

impl Module for OsModule {
    fn name(&self) -> &str {
        "repo-os"
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REPO_REQUEST_TOPIC);
        context.subscribe(PROMPT_RESPONSE_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.bus
            .as_ref()
            .map(|_| ())
            .ok_or_else(|| "no Bus service available".into())
    }

    fn render(&mut self) {
        let Some(bus) = self.bus.clone() else { return };
        let Ok(entries) = std::fs::read_dir(prompt_directory()) else { return };
        let mut waiting = HashSet::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.extension().is_some_and(|extension| extension == "request") {
                continue;
            }
            let (Some(id), Ok(body)) = (
                path.file_stem().and_then(|value| value.to_str()),
                std::fs::read_to_string(&path),
            ) else {
                continue;
            };
            waiting.insert(id.to_string());
            if !self.announced.insert(id.to_string()) {
                continue;
            }
            let payload = format!("{id}\n{body}").into_bytes();
            bus.publish(Envelope { topic: PROMPT_TOPIC.into(), sender: "os".into(), correlation: None, payload });
        }
        // Answered or abandoned: askpass removes its request either way, and
        // forgetting it here lets a later prompt with the same id -- a
        // restarted helper counts from one again -- be announced afresh.
        self.announced.retain(|id| waiting.contains(id));
    }
}

fn prompt_directory() -> std::path::PathBuf {
    std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.join("saves/prompts"))).unwrap_or_else(|| std::path::PathBuf::from("saves/prompts"))
}

fn execute_repo(backend: &dyn RepoOsBackend, request: &OsRequest) -> NativeResult {
    let outcome = match request.action {
        0 => backend.read_file(&request.value),
        1 => backend.find_repositories(&request.value),
        2 => backend.run_tool(&request.value).map(|_| Some(String::new())),
        _ => Err("unknown repo-os action".into()),
    };
    into_result(request.request_id, outcome)
}

/// Shapes either endpoint's outcome into the one result both report.
///
/// `Ok(None)` is not an error: an absent file, a folder holding no repository
/// and a 404 are all normal answers, reported as `accepted: false` with no
/// error text.
fn into_result(request_id: u32, outcome: Result<Option<String>, String>) -> NativeResult {
    match outcome {
        Ok(value) => NativeResult {
            request_id,
            accepted: value.is_some(),
            value: value.unwrap_or_default(),
            error: String::new(),
        },
        Err(error) => NativeResult {
            request_id,
            accepted: false,
            value: String::new(),
            error,
        },
    }
}

#[cfg(test)]
mod rendezvous_tests;
#[cfg(test)]
mod tests;
