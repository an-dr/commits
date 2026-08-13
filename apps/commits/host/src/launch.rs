use std::path::{Path, PathBuf};

use bones_engine::bus::{Envelope, Handler, Module, ModuleContext};

/// Bus endpoint reporting the repository named on the command line, if any.
pub const ENDPOINT: &str = "launch";

const OWNER: &str = "commits";
const NONE: u8 = 0;
const REPOSITORY: u8 = 1;
const REJECTED: u8 = 2;

/// Answers what `commits <path>` asked for: an absolute repository path, a
/// reason that path was refused, or nothing at all when the app was started
/// without an argument.
///
/// The check lives here rather than in the component because the component is
/// a sandboxed WASM guest with no filesystem access at all -- it cannot tell
/// a typo from a repository, and asking `git` through the bus would report a
/// missing folder as an ordinary command failure long after the window has
/// already decided what to show. Resolving and checking once at construction
/// also means the answer cannot change between the guest asking and acting.
pub struct LaunchModule {
    outcome: Outcome,
}

enum Outcome {
    /// No argument: an ordinary double-click or shortcut start.
    Absent,
    Repository(PathBuf),
    Rejected(String),
}

impl Default for LaunchModule {
    fn default() -> Self {
        Self::from_args(std::env::args().skip(1), std::env::current_dir().ok().as_deref())
    }
}

impl LaunchModule {
    /// Reads the first argument as a repository path. Later arguments are
    /// ignored rather than refused: this app takes exactly one, and a shell
    /// glob or a stray flag should not stop it opening.
    fn from_args(mut args: impl Iterator<Item = String>, working_dir: Option<&Path>) -> Self {
        let Some(argument) = args.next() else {
            return Self { outcome: Outcome::Absent };
        };
        Self { outcome: check(&argument, working_dir) }
    }

    #[cfg(test)]
    fn from_argument(argument: &str, working_dir: Option<&Path>) -> Self {
        Self { outcome: check(argument, working_dir) }
    }
}

/// Resolves `argument` against `working_dir` and reports whether it names a
/// git repository.
///
/// A relative path is resolved against the process's working directory, not
/// the executable's, so `commits .` means the folder the user is standing in
/// -- the opposite of the engine's own convention for `extensions_dir`, and
/// right here for the same reason it is wrong there: this path comes from a
/// shell, and those two conventions disagree only because the inputs do.
fn check(argument: &str, working_dir: Option<&Path>) -> Outcome {
    let trimmed = argument.trim();
    if trimmed.is_empty() {
        return Outcome::Rejected(String::from("the repository path given on the command line is empty"));
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
    // A worktree or submodule has `.git` as a file rather than a directory,
    // so existence is the test, not `is_dir`.
    if !absolute.join(".git").exists() {
        return Outcome::Rejected(format!("{display} is not a git repository"));
    }
    Outcome::Repository(PathBuf::from(display))
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
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for LaunchModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }

    /// One byte of kind, then the path or the reason. The guest asks once at
    /// startup and needs all three cases distinguishable: open it, show the
    /// chooser with this reason, or show the chooser with nothing to say.
    fn respond(&mut self, sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode(REJECTED, "the launch argument is private to the commits component"));
        }
        Some(match &self.outcome {
            Outcome::Absent => encode(NONE, ""),
            Outcome::Repository(path) => encode(REPOSITORY, &path.to_string_lossy()),
            Outcome::Rejected(reason) => encode(REJECTED, reason),
        })
    }
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
        (response[0], String::from_utf8(response[1..].to_vec()).unwrap())
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
        let mut module = LaunchModule::from_argument(&directory.path().join("absent").to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REJECTED);
        assert!(text.contains("nothing at"), "{text}");
    }

    #[test]
    fn rejects_a_folder_that_is_not_a_repository() {
        let directory = tempfile::tempdir().unwrap();
        let mut module = LaunchModule::from_argument(&directory.path().to_string_lossy(), None);

        let (kind, text) = decode(&module.respond("commits", &[]).unwrap());

        assert_eq!(kind, REJECTED);
        assert!(text.contains("not a git repository"), "{text}");
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
        let args = vec![path.to_string_lossy().into_owned(), String::from("--nonsense")];
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
}
