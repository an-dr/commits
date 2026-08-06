use std::path::{Path, PathBuf};

use bus::{Envelope, Handler, Module, ModuleContext};

/// Bus endpoint reporting the fixed local clone of the commits project's own
/// repository, at `~/.commits/repo`.
pub const ENDPOINT: &str = "commits-repo";

const OWNER: &str = "commits";
const SUCCESS: u8 = 0;
const FAILURE: u8 = 1;
const ABSENT: u8 = 0;
const PRESENT: u8 = 1;

/// Answers with whether `~/.commits/repo` exists and its absolute path.
///
/// The path itself is resolved once here, the same way `SettingsModule`
/// resolves `~/.commits/settings.json`, so the sandboxed component never
/// needs its own access to the home directory: it clones, opens, and reveals
/// the path this module reports rather than computing one itself.
pub struct CommitsRepoModule {
    path: Option<PathBuf>,
}

impl Default for CommitsRepoModule {
    fn default() -> Self {
        let path = dirs::home_dir().map(|home| home.join(".commits").join("repo"));
        Self { path }
    }
}

impl CommitsRepoModule {
    #[cfg(test)]
    fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: Some(path.into()) }
    }

    fn resolve_path(&self) -> Result<&Path, String> {
        self.path
            .as_deref()
            .ok_or_else(|| String::from("could not resolve the user home directory"))
    }
}

impl Handler for CommitsRepoModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for CommitsRepoModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        self.resolve_path().map(|_| ())
    }

    /// Reports existence and path in one round trip: the component needs both
    /// before it can enable Open/Reveal, or decide whether Clone would clone
    /// into an already-populated folder.
    fn respond(&mut self, sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode_failure("the commits repo path is private to the commits component"));
        }
        Some(match self.resolve_path() {
            Ok(path) => {
                let present = if path.exists() { PRESENT } else { ABSENT };
                encode_success(present, &path.to_string_lossy())
            }
            Err(error) => encode_failure(&error),
        })
    }
}

fn encode_success(present: u8, path: &str) -> Vec<u8> {
    let mut response = Vec::with_capacity(path.len() + 2);
    response.push(SUCCESS);
    response.push(present);
    response.extend(path.as_bytes());
    response
}

fn encode_failure(message: &str) -> Vec<u8> {
    let mut response = Vec::with_capacity(message.len() + 1);
    response.push(FAILURE);
    response.extend(message.as_bytes());
    response
}

#[cfg(test)]
mod tests {
    use super::{CommitsRepoModule, Module, ABSENT, FAILURE, PRESENT, SUCCESS};

    #[test]
    fn reports_absent_for_a_folder_that_does_not_exist_yet() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("repo");
        let mut module = CommitsRepoModule::new(&path);

        let response = module.respond("commits", &[]).unwrap();

        assert_eq!(response[0], SUCCESS);
        assert_eq!(response[1], ABSENT);
        assert_eq!(
            String::from_utf8(response[2..].to_vec()).unwrap(),
            path.to_string_lossy()
        );
    }

    #[test]
    fn reports_present_once_the_folder_exists() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("repo");
        std::fs::create_dir_all(&path).unwrap();
        let mut module = CommitsRepoModule::new(&path);

        let response = module.respond("commits", &[]).unwrap();

        assert_eq!(response[0], SUCCESS);
        assert_eq!(response[1], PRESENT);
    }

    #[test]
    fn rejects_other_components() {
        let mut module = CommitsRepoModule::new(std::env::temp_dir());

        assert_eq!(module.respond("other", &[]).unwrap()[0], FAILURE);
    }

    #[test]
    fn reports_an_unresolved_home_instead_of_a_working_directory_guess() {
        let mut module = CommitsRepoModule { path: None };

        let response = module.respond("commits", &[]).unwrap();

        assert_eq!(response[0], FAILURE);
        assert!(String::from_utf8(response[1..].to_vec()).unwrap().contains("home directory"));
    }
}
