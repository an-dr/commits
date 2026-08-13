use std::path::{Path, PathBuf};

use bones_engine::bus::{Envelope, Handler, Module, ModuleContext};

/// Bus endpoint reporting the fixed local clone of the commits project's own
/// repository, at `~/.commits/repo`.
pub const ENDPOINT: &str = "commits-repo";

const OWNER: &str = "commits";
const SUCCESS: u8 = 0;
const FAILURE: u8 = 1;
const ABSENT: u8 = 0;
const PRESENT: u8 = 1;

/// Answers with whether `~/.commits/repo` exists, its absolute path, and its
/// parent directory (`~/.commits`).
///
/// The paths are resolved once here, the same way `SettingsModule` resolves
/// `~/.commits/settings.json`, so the sandboxed component never needs its own
/// access to the home directory: it clones, opens, and reveals the path this
/// module reports rather than computing one itself. The parent is reported
/// too because a `git clone` needs a working directory that already exists to
/// spawn into, and `~/.commits` may not exist yet on a fresh install.
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

    /// Best-effort: a clone into `~/.commits/repo` needs `~/.commits` to
    /// already exist to spawn `git` into, so it is created once up front
    /// rather than on every status query. If this fails, the later clone
    /// attempt surfaces a clearer error from `git` itself.
    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        let path = self.resolve_path()?;
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Ok(())
    }

    /// Reports existence, path, and parent in one round trip: the component
    /// needs the path before it can enable Open/Reveal or decide whether
    /// Clone would clone into an already-populated folder, and the parent as
    /// the working directory to spawn `git clone` into.
    fn respond(&mut self, sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode_failure("the commits repo path is private to the commits component"));
        }
        Some(match self.resolve_path() {
            Ok(path) => {
                let present = if path.exists() { PRESENT } else { ABSENT };
                let parent = path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                encode_success(present, &parent, &path.to_string_lossy())
            }
            Err(error) => encode_failure(&error),
        })
    }
}

fn encode_success(present: u8, parent: &str, path: &str) -> Vec<u8> {
    let mut response = Vec::with_capacity(parent.len() + path.len() + 3);
    response.push(SUCCESS);
    response.push(present);
    response.extend(parent.as_bytes());
    response.push(b'\n');
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

    fn decode_success(response: &[u8]) -> (u8, String, String) {
        assert_eq!(response[0], SUCCESS);
        let present = response[1];
        let text = String::from_utf8(response[2..].to_vec()).unwrap();
        let (parent, path) = text.split_once('\n').unwrap();
        (present, parent.to_string(), path.to_string())
    }

    #[test]
    fn reports_absent_for_a_folder_that_does_not_exist_yet() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("repo");
        let mut module = CommitsRepoModule::new(&path);

        let (present, parent, reported_path) = decode_success(&module.respond("commits", &[]).unwrap());

        assert_eq!(present, ABSENT);
        assert_eq!(parent, directory.path().to_string_lossy());
        assert_eq!(reported_path, path.to_string_lossy());
    }

    #[test]
    fn reports_present_once_the_folder_exists() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("repo");
        std::fs::create_dir_all(&path).unwrap();
        let mut module = CommitsRepoModule::new(&path);

        let (present, ..) = decode_success(&module.respond("commits", &[]).unwrap());

        assert_eq!(present, PRESENT);
    }

    #[test]
    fn creates_the_parent_directory_on_init_so_a_clone_has_somewhere_to_spawn_into() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("nested/.commits");
        let mut module = CommitsRepoModule::new(parent.join("repo"));

        assert!(!parent.exists());
        Module::init(&mut module, &mut bones_engine::bus::ModuleContext::new(&mut bones_engine::bus::ServiceRegistry::new())).unwrap();

        assert!(parent.is_dir());
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
