use std::path::{Path, PathBuf};

use crate::launch_request::{parse, LaunchRequest};
use bones_kernel::bus::{Bus, Envelope, Handler, Module, ModuleContext};
use bones_messages::{DecodeMessage, Message};

/// Bus endpoint reporting the repository named on the command line, if any.
pub const ENDPOINT: &str = "launch";

const OWNER: &str = "commits";
#[cfg(test)]
const NONE: u8 = 0;
#[cfg(test)]
const REPOSITORY: u8 = 1;
const REJECTED: u8 = 2;

/// Answers what `commits <path>` asked for: the repositories found at or
/// below that path, a reason it was refused, or nothing at all when the app
/// was started without an argument.
///
/// The check lives here rather than in the component because the component is
/// a sandboxed WASM guest with no filesystem access at all -- it cannot tell
/// a typo from a repository, and asking `git` through the bus would report a
/// missing folder as an ordinary command failure long after the window has
/// already decided what to show. Resolving and checking once at construction
/// also means the answer cannot change between the guest asking and acting.
pub struct LaunchModule {
    outcome: Outcome,
    request: LaunchRequest,
    theme_file: Option<Result<serde_json::Value, String>>,
    sequence: u32,
    bus: Option<Bus>,
}

enum Outcome {
    /// No argument: an ordinary double-click or shortcut start.
    Absent,
    /// Every repository at or below the argument, the one to open first.
    Repositories(Vec<PathBuf>),
    Rejected(String),
}

impl Default for LaunchModule {
    fn default() -> Self {
        Self::from_args(
            std::env::args().skip(1),
            std::env::current_dir().ok().as_deref(),
        )
    }
}

impl LaunchModule {
    /// Resolves the launch once; the parser stays pure and file access stays native.
    fn from_args(args: impl Iterator<Item = String>, working_dir: Option<&Path>) -> Self {
        let request = parse(&args.collect::<Vec<_>>(), working_dir);
        let outcome = request
            .path
            .as_deref()
            .map_or(Outcome::Absent, |path| check(path, working_dir));
        let theme_file = request.theme_file.as_deref().map(read_theme_file);
        Self {
            outcome,
            request,
            theme_file,
            sequence: 0,
            bus: None,
        }
    }

    #[cfg(test)]
    fn from_argument(argument: &str, working_dir: Option<&Path>) -> Self {
        Self::from_args([argument.to_string()].into_iter(), working_dir)
    }

    fn encode(&self) -> Vec<u8> {
        let mut value = match &self.outcome {
            Outcome::Absent => serde_json::json!({"kind":"none"}),
            Outcome::Repositories(paths) => serde_json::json!({"kind":"repository", "paths":paths}),
            Outcome::Rejected(reason) => serde_json::json!({"kind":"rejected", "reason":reason}),
        };
        value["show"] = serde_json::json!(self.request.show);
        value["branch"] = serde_json::json!(self.request.branch);
        value["commit"] = serde_json::json!(self.request.commit);
        value["theme"] = serde_json::json!(self.request.theme);
        if let Some(path) = &self.request.theme_file {
            value["themeFileName"] = serde_json::json!(path);
            match self
                .theme_file
                .as_ref()
                .expect("a theme path has a read result")
            {
                Ok(file) => value["themeFile"] = file.clone(),
                Err(error) => value["themeFileError"] = serde_json::json!(error),
            }
        }
        commits_ipc::native::LaunchRequest {
            sequence: self.sequence,
            json: value.to_string(),
        }
        .encode()
        .unwrap()
    }
}

/// Resolves `argument` against `working_dir` and reports the git repositories
/// it holds.
///
/// A folder that is not a repository itself is still accepted when it contains
/// some, which is how a folder of unrelated clones opens: the whole set is
/// reported, and the guest opens the first.
///
/// A relative path is resolved against the process's working directory, not
/// the executable's, so `commits .` means the folder the user is standing in
/// -- the opposite of the engine's own convention for `extensions_dir`, and
/// right here for the same reason it is wrong there: this path comes from a
/// shell, and those two conventions disagree only because the inputs do.
fn check(argument: &str, working_dir: Option<&Path>) -> Outcome {
    let trimmed = argument.trim();
    if trimmed.is_empty() {
        return Outcome::Rejected(String::from(
            "the repository path given on the command line is empty",
        ));
    }
    let requested = PathBuf::from(trimmed);
    let resolved = if requested.is_absolute() {
        requested
    } else {
        match working_dir {
            Some(dir) => dir.join(&requested),
            None => {
                return Outcome::Rejected(format!(
                    "could not resolve the relative path '{trimmed}': the working directory is unavailable"
                ))
            }
        }
    };
    // Canonicalized so the path the guest remembers as "recent" is the same
    // string however it was typed -- `.`, `..\other`, or a different case on
    // Windows all reach one entry rather than three.
    let absolute = std::fs::canonicalize(&resolved).unwrap_or(resolved);
    let display = strip_verbatim(&absolute);
    if !absolute.exists() {
        return Outcome::Rejected(format!("there is nothing at {display}"));
    }
    if !absolute.is_dir() {
        return Outcome::Rejected(format!("{display} is a file, not a repository folder"));
    }
    let found = commits_os::discover::find_repositories(Path::new(&display));
    if found.is_empty() {
        return Outcome::Rejected(format!("there is no git repository in {display}"));
    }
    Outcome::Repositories(found)
}

/// Drops Windows' `\\?\` verbatim prefix, which `canonicalize` adds and no
/// user ever typed. It survives every comparison and display untouched
/// otherwise, so a recent-repository list would show paths nobody recognises.
fn strip_verbatim(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    match text.strip_prefix(r"\\?\") {
        Some(stripped) => stripped.to_string(),
        None => text,
    }
}

impl Handler for LaunchModule {
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic != bones_messages::instance::Launched::TOPIC
            || envelope.sender != "instance"
        {
            return;
        }
        let Ok(handoff) = bones_messages::instance::Launched::decode(&envelope.payload) else {
            return;
        };
        let next = Self::from_args(
            handoff.args.into_iter().map(str::to_string),
            Some(Path::new(handoff.cwd)),
        );
        self.request = next.request;
        self.theme_file = next.theme_file;
        self.outcome = next.outcome;
        self.sequence = self.sequence.saturating_add(1);
        if let Some(bus) = &self.bus {
            bus.publish(Envelope {
                topic: "launch/request".into(),
                sender: ENDPOINT.into(),
                correlation: None,
                payload: self.encode(),
            });
        }
    }
}

impl Module for LaunchModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(bones_messages::instance::Launched::TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        Ok(())
    }

    /// The shared launch encoding answers startup; a nonempty payload queries
    /// a repository's native path and operation facts for the health reader.
    fn respond(&mut self, sender: &str, payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode(
                REJECTED,
                "the launch argument is private to the commits component",
            ));
        }
        if !payload.is_empty() {
            let path = std::str::from_utf8(payload).ok()?;
            return serde_json::to_vec(&repository_state(Path::new(path))).ok();
        }
        Some(self.encode())
    }
}

/// Reads a caller's palette once, with a bounded read even if the file changes size.
fn read_theme_file(path: &Path) -> Result<serde_json::Value, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("exceeds 256 KiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

/// Launch-path checks and operation markers are read natively, including linked worktrees.
fn repository_state(path: &Path) -> serde_json::Value {
    let marker = path.join(".git");
    let metadata = if marker.is_dir() {
        Some(marker)
    } else {
        std::fs::read_to_string(&marker)
            .ok()
            .and_then(|text| {
                text.trim().strip_prefix("gitdir:").map(|value| {
                    let target = PathBuf::from(value.trim());
                    if target.is_absolute() {
                        target
                    } else {
                        path.join(target)
                    }
                })
            })
            .filter(|target| target.is_dir())
    };
    let operation = metadata.as_ref().and_then(|git| {
        [
            ("rebase-merge", "rebase"),
            ("rebase-apply", "rebase"),
            ("MERGE_HEAD", "merge"),
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
            ("BISECT_LOG", "bisect"),
        ]
        .into_iter()
        .find(|(marker, _)| git.join(marker).exists())
        .map(|(_, operation)| operation)
    });
    serde_json::json!({ "exists": path.is_dir(), "isRepo": metadata.is_some(), "operation": operation })
}

fn encode(kind: u8, text: &str) -> Vec<u8> {
    let mut response = Vec::with_capacity(text.len() + 1);
    response.push(kind);
    response.extend(text.as_bytes());
    response
}

#[cfg(test)]
mod tests {
    use super::{LaunchModule, Module, NONE, REJECTED, REPOSITORY};
    use std::path::Path;

    fn decode(response: &[u8]) -> (u8, String) {
        let request = commits_ipc::native::LaunchRequest::decode(response).unwrap();
        let value: serde_json::Value = serde_json::from_str(&request.json).unwrap();
        match value["kind"].as_str().unwrap() {
            "repository" => (
                REPOSITORY,
                value["paths"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|path| path.as_str().unwrap())
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            "rejected" => (REJECTED, value["reason"].as_str().unwrap().to_string()),
            _ => (NONE, String::new()),
        }
    }

    fn repository(root: &Path) -> std::path::PathBuf {
        let path = root.join("repo");
        std::fs::create_dir_all(path.join(".git")).unwrap();
        path
    }

    #[test]
    fn reports_no_argument_as_absent_rather_than_as_a_failure() {
        let mut module = LaunchModule::from_args(std::iter::empty(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, NONE);
        assert!(text.is_empty());
    }

    #[test]
    fn accepts_an_absolute_repository_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = repository(directory.path());
        let mut module = LaunchModule::from_argument(&path.to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
        assert!(Path::new(&text).ends_with("repo"), "{text}");
    }

    #[test]
    fn resolves_a_relative_path_against_the_working_directory() {
        let directory = tempfile::tempdir().unwrap();
        let path = repository(directory.path());
        let mut module = LaunchModule::from_argument("repo", Some(directory.path()));

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
        assert!(Path::new(&text).ends_with("repo"), "{text}");
        assert!(Path::new(&text).is_absolute(), "{text}");
        let _ = path;
    }

    #[test]
    fn resolves_dot_to_the_working_directory_itself() {
        let directory = tempfile::tempdir().unwrap();
        let path = repository(directory.path());
        let mut module = LaunchModule::from_argument(".", Some(&path));

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
        assert!(Path::new(&text).ends_with("repo"), "{text}");
    }

    #[test]
    fn rejects_a_path_that_does_not_exist_and_says_so() {
        let directory = tempfile::tempdir().unwrap();
        let mut module =
            LaunchModule::from_argument(&directory.path().join("absent").to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REJECTED);
        assert!(text.contains("nothing at"), "{text}");
    }

    #[test]
    fn rejects_a_folder_with_no_repository_anywhere_below_it() {
        let directory = tempfile::tempdir().unwrap();
        let mut module = LaunchModule::from_argument(&directory.path().to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REJECTED);
        assert!(text.contains("no git repository"), "{text}");
    }

    #[test]
    fn accepts_a_folder_of_unrelated_repositories_and_lists_them_all() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("alpha/.git")).unwrap();
        std::fs::create_dir_all(directory.path().join("beta/.git")).unwrap();
        let mut module = LaunchModule::from_argument(&directory.path().to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
        let paths: Vec<&str> = text.lines().collect();
        assert_eq!(paths.len(), 2, "{text}");
        assert!(Path::new(paths[0]).ends_with("alpha"), "{text}");
        assert!(Path::new(paths[1]).ends_with("beta"), "{text}");
    }

    #[test]
    fn lists_a_repository_cloned_inside_the_one_that_was_named() {
        let directory = tempfile::tempdir().unwrap();
        let path = repository(directory.path());
        std::fs::create_dir_all(path.join("nested/.git")).unwrap();
        let mut module = LaunchModule::from_argument(&path.to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
        let paths: Vec<&str> = text.lines().collect();
        assert_eq!(paths.len(), 2, "{text}");
        assert!(Path::new(paths[0]).ends_with("repo"), "{text}");
        assert!(Path::new(paths[1]).ends_with("nested"), "{text}");
    }

    #[test]
    fn rejects_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("README.md");
        std::fs::write(&file, b"").unwrap();
        let mut module = LaunchModule::from_argument(&file.to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REJECTED);
        assert!(text.contains("not a repository folder"), "{text}");
    }

    #[test]
    fn accepts_a_worktree_whose_git_is_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("worktree");
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join(".git"), b"gitdir: ../repo/.git/worktrees/w").unwrap();
        let mut module = LaunchModule::from_argument(&path.to_string_lossy(), None);

        let (kind, _) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
    }

    #[test]
    fn ignores_arguments_after_the_first() {
        let directory = tempfile::tempdir().unwrap();
        let path = repository(directory.path());
        let args = vec![
            path.to_string_lossy().into_owned(),
            String::from("--nonsense"),
        ];
        let mut module = LaunchModule::from_args(args.into_iter(), None);

        let (kind, _) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REPOSITORY);
    }

    #[test]
    fn rejects_other_components() {
        let mut module = LaunchModule::from_args(std::iter::empty(), None);

        assert_eq!(module.respond("other", &[]).unwrap()[0], REJECTED);
    }

    #[test]
    fn rejects_a_blank_argument_rather_than_treating_it_as_absent() {
        let mut module = LaunchModule::from_argument("   ", None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REJECTED);
        assert!(text.contains("empty"), "{text}");
    }

    #[test]
    fn handoff_updates_the_endpoint_and_publishes_the_next_sequence() {
        use bones_kernel::bus::{Bus, Envelope, Handler, ModuleContext, ServiceRegistry};
        use bones_messages::{EncodeMessage, Message};
        let directory = tempfile::tempdir().unwrap();
        repository(directory.path());
        let bus = Bus::new();
        let mut services = ServiceRegistry::new();
        services.provide(bus).unwrap();
        let mut module = LaunchModule::from_args(std::iter::empty(), None);
        module.init(&mut ModuleContext::new(&mut services)).unwrap();
        let payload = bones_messages::instance::Launched {
            cwd: directory.path().to_str().unwrap(),
            args: vec!["repo", "--show=conflicts"],
        }
        .encode();
        module.handle(&Envelope {
            topic: bones_messages::instance::Launched::TOPIC.into(),
            sender: "instance".into(),
            correlation: None,
            payload,
        });
        let request =
            commits_ipc::native::LaunchRequest::decode(&module.respond("commits", &[]).unwrap())
                .unwrap();
        assert_eq!(request.sequence, 1);
        let value: serde_json::Value = serde_json::from_str(&request.json).unwrap();
        assert_eq!(value["show"], "conflicts");
        assert_eq!(value["kind"], "repository");
    }

    #[test]
    fn detects_bisect_and_linked_worktree_operation_markers() {
        let directory = tempfile::tempdir().unwrap();
        let worktree = directory.path().join("worktree");
        let git = directory.path().join("metadata");
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::create_dir_all(&git).unwrap();
        std::fs::write(worktree.join(".git"), "gitdir: ../metadata").unwrap();
        std::fs::write(git.join("BISECT_LOG"), "bisect").unwrap();
        assert_eq!(super::repository_state(&worktree)["operation"], "bisect");
        assert_eq!(
            super::repository_state(&directory.path().join("missing"))["exists"],
            false
        );
    }

    #[test]
    fn reads_the_theme_once_and_rejects_oversized_files() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("palette.json");
        std::fs::write(&file, "{\"version\":1}").unwrap();
        let args = vec![
            "--theme-file".to_string(),
            file.to_string_lossy().into_owned(),
        ];
        let mut module = LaunchModule::from_args(args.into_iter(), None);
        std::fs::write(&file, "malformed").unwrap();
        let response =
            commits_ipc::native::LaunchRequest::decode(&module.respond("commits", &[]).unwrap())
                .unwrap();
        let value: serde_json::Value = serde_json::from_str(&response.json).unwrap();
        assert_eq!(value["themeFile"]["version"], 1);
        std::fs::write(&file, vec![b' '; 256 * 1024 + 1]).unwrap();
        assert!(super::read_theme_file(&file)
            .unwrap_err()
            .contains("256 KiB"));
    }
}
