use std::io::Write;
use std::path::{Path, PathBuf};

use bus::{Envelope, Handler, Module, ModuleContext};
use tempfile::NamedTempFile;

/// Bus endpoint for the standalone application's user-facing settings file.
pub const ENDPOINT: &str = "settings";

const OWNER: &str = "commits";
const LOAD: u8 = 0;
const SAVE: u8 = 1;
const SUCCESS: u8 = 0;
const FAILURE: u8 = 1;

/// Owns raw access to `~/.commits/settings.json` for the sandboxed component.
pub struct SettingsModule {
    path: Option<PathBuf>,
}

impl Default for SettingsModule {
    fn default() -> Self {
        let path = dirs::home_dir().map(|home| home.join(".commits").join("settings.json"));
        Self { path }
    }
}

impl SettingsModule {
    #[cfg(test)]
    fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: Some(path.into()),
        }
    }

    fn load(&self) -> Result<Vec<u8>, String> {
        let path = self.resolve_path()?;
        match std::fs::read(path) {
            Ok(bytes) => Ok(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(format!("reading {}: {error}", path.display())),
        }
    }

    fn save(&self, bytes: &[u8]) -> Result<(), String> {
        let path = self.resolve_path()?;
        let directory = path
            .parent()
            .ok_or_else(|| String::from("settings path has no parent directory"))?;
        std::fs::create_dir_all(directory)
            .map_err(|error| format!("creating {}: {error}", directory.display()))?;

        let mut temporary = NamedTempFile::new_in(directory)
            .map_err(|error| format!("creating settings temporary file: {error}"))?;
        temporary
            .write_all(bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|error| format!("writing settings temporary file: {error}"))?;
        temporary
            .persist(path)
            .map_err(|error| format!("replacing {}: {}", path.display(), error.error))?;
        sync_directory(directory);
        Ok(())
    }

    fn resolve_path(&self) -> Result<&Path, String> {
        self.path
            .as_deref()
            .ok_or_else(|| String::from("could not resolve the user home directory"))
    }
}

impl Handler for SettingsModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for SettingsModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        self.resolve_path().map(|_| ())
    }

    /// Loads or replaces the raw document. The trusted host stamps `sender`.
    fn respond(&mut self, sender: &str, payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode_failure(
                "settings are private to the commits component",
            ));
        }
        let Some((&action, value)) = payload.split_first() else {
            return Some(encode_failure("settings request has no action"));
        };
        Some(match action {
            LOAD => self
                .load()
                .map(encode_success)
                .unwrap_or_else(|error| encode_failure(&error)),
            SAVE => self
                .save(value)
                .map(|()| encode_success(Vec::new()))
                .unwrap_or_else(|error| encode_failure(&error)),
            _ => encode_failure("unknown settings action"),
        })
    }
}

fn encode_success(value: Vec<u8>) -> Vec<u8> {
    let mut response = Vec::with_capacity(value.len() + 1);
    response.push(SUCCESS);
    response.extend(value);
    response
}

fn encode_failure(message: &str) -> Vec<u8> {
    let mut response = Vec::with_capacity(message.len() + 1);
    response.push(FAILURE);
    response.extend(message.as_bytes());
    response
}

#[cfg(not(windows))]
fn sync_directory(directory: &Path) {
    let _ = std::fs::File::open(directory).and_then(|file| file.sync_all());
}

#[cfg(windows)]
fn sync_directory(_directory: &Path) {}

#[cfg(test)]
mod tests {
    use super::{Module, SettingsModule, FAILURE, LOAD, SAVE, SUCCESS};

    #[test]
    fn loads_missing_settings_and_atomically_replaces_existing_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested/settings.json");
        let mut module = SettingsModule::new(&path);

        assert_eq!(module.respond("commits", &[LOAD]), Some(vec![SUCCESS]));
        assert_eq!(
            module.respond("commits", &[SAVE, b'o', b'l', b'd']),
            Some(vec![SUCCESS])
        );
        assert_eq!(
            module.respond("commits", &[SAVE, b'n', b'e', b'w']),
            Some(vec![SUCCESS])
        );
        assert_eq!(
            module.respond("commits", &[LOAD]),
            Some(vec![SUCCESS, b'n', b'e', b'w'])
        );
        assert_eq!(std::fs::read(path).unwrap(), b"new");
    }

    #[test]
    fn rejects_other_components_and_malformed_requests() {
        let directory = tempfile::tempdir().unwrap();
        let mut module = SettingsModule::new(directory.path().join("settings.json"));

        assert_eq!(module.respond("other", &[LOAD]).unwrap()[0], FAILURE);
        assert_eq!(module.respond("commits", &[]).unwrap()[0], FAILURE);
        assert_eq!(module.respond("commits", &[9]).unwrap()[0], FAILURE);
    }

    #[test]
    fn reports_an_unresolved_home_instead_of_using_the_working_directory() {
        let mut module = SettingsModule { path: None };

        let response = module.respond("commits", &[LOAD]).unwrap();

        assert_eq!(response[0], FAILURE);
        assert!(String::from_utf8(response[1..].to_vec())
            .unwrap()
            .contains("home directory"));
    }
}
