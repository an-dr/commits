use std::io::Write;
use std::path::{Path, PathBuf};

use bones_engine::bus::{Envelope, Handler, Module, ModuleContext};
use tempfile::NamedTempFile;

/// Bus endpoint for the standalone application's user-facing settings file.
pub const ENDPOINT: &str = "settings";

const OWNER: &str = "commits";
const LOAD: u8 = 0;
const SAVE: u8 = 1;
const SUCCESS: u8 = 0;
const FAILURE: u8 = 1;

/// Attempts at replacing the settings file, and the pause after the first
/// failure. The pause widens by a further step each time, so the five attempts
/// span roughly 200ms in total -- long enough to outlast a scanner reading the
/// file, short enough that a genuine permission error still surfaces promptly.
const REPLACE_ATTEMPTS: u32 = 5;
const REPLACE_BACKOFF: std::time::Duration = std::time::Duration::from_millis(20);

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
        persist_retrying_transient_conflicts(temporary, path)
            .map_err(|error| format!("replacing {}: {error}", path.display()))?;
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

/// Replacing the settings file is not reliably atomic on Windows: the rename
/// fails with `ERROR_ACCESS_DENIED` or `ERROR_SHARING_VIOLATION` whenever
/// another process still holds the destination open, which a virus scanner or
/// the search indexer routinely does for the moments after we write it. The
/// condition clears in milliseconds, so giving up on the first attempt loses a
/// user's settings to a race that resolves itself. Retry a few times with a
/// widening pause before reporting the failure.
fn persist_retrying_transient_conflicts(
    temporary: NamedTempFile,
    path: &Path,
) -> Result<(), std::io::Error> {
    let mut temporary = temporary;
    let mut attempt = 1;
    loop {
        match temporary.persist(path) {
            Ok(_) => return Ok(()),
            Err(error) => {
                if attempt >= REPLACE_ATTEMPTS || !is_transient_conflict(&error.error) {
                    return Err(error.error);
                }
                temporary = error.file;
                std::thread::sleep(REPLACE_BACKOFF * attempt);
                attempt += 1;
            }
        }
    }
}

/// Whether a failed replace describes another process holding the destination
/// rather than a permission the app genuinely lacks. Only Windows produces the
/// transient form; elsewhere a denial is a denial, and retrying it would just
/// delay the error the caller needs to see.
#[cfg(windows)]
fn is_transient_conflict(error: &std::io::Error) -> bool {
    const ERROR_SHARING_VIOLATION: i32 = 32;
    error.kind() == std::io::ErrorKind::PermissionDenied
        || error.raw_os_error() == Some(ERROR_SHARING_VIOLATION)
}

#[cfg(not(windows))]
fn is_transient_conflict(_error: &std::io::Error) -> bool {
    false
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

    /// Reproduces the race that made the test above fail intermittently under a
    /// parallel run: another process holding the destination open makes the
    /// replace fail with `ERROR_ACCESS_DENIED` until it lets go. A share mode of
    /// zero is what a scanner's exclusive read looks like from here, and the
    /// save must outlast it rather than report a failure the user cannot act on.
    #[cfg(windows)]
    #[test]
    fn a_save_outlasts_another_process_briefly_holding_the_settings_file() {
        use std::os::windows::fs::OpenOptionsExt;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let mut module = SettingsModule::new(&path);
        assert_eq!(
            module.respond("commits", &[SAVE, b'o', b'l', b'd']),
            Some(vec![SUCCESS])
        );

        let blocker = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let holder = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            drop(blocker);
        });

        assert_eq!(
            module.respond("commits", &[SAVE, b'n', b'e', b'w']),
            Some(vec![SUCCESS])
        );
        holder.join().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"new");
    }

    /// A denial that is not another process letting go must still be reported
    /// rather than retried into a delayed identical failure.
    #[test]
    fn a_save_into_an_unwritable_location_fails_without_retrying() {
        let directory = tempfile::tempdir().unwrap();
        let occupied = directory.path().join("settings.json");
        std::fs::write(&occupied, b"in the way").unwrap();
        let mut module = SettingsModule::new(occupied.join("nested.json"));

        let response = module.respond("commits", &[SAVE, b'x']).unwrap();

        assert_eq!(response[0], FAILURE);
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
