use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);

pub struct Prompt {
    id: String,
    directory: PathBuf,
}

impl Prompt {
    pub fn create(directory: &Path, kind: &str, payload: &str) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let id = format!(
            "{}-{}",
            std::process::id(),
            NEXT_REQUEST.fetch_add(1, Ordering::Relaxed)
        );
        let path = directory.join(format!("{id}.request"));
        std::fs::write(path, format!("{kind}\n{payload}")).map_err(|error| error.to_string())?;
        Ok(Self {
            id,
            directory: directory.to_path_buf(),
        })
    }

    pub fn wait(self, timeout: Duration) -> Result<String, String> {
        let response = self.directory.join(format!("{}.response", self.id));
        let request = self.directory.join(format!("{}.request", self.id));
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if response.exists() {
                let value =
                    std::fs::read_to_string(&response).map_err(|error| error.to_string())?;
                let _ = std::fs::remove_file(response);
                let _ = std::fs::remove_file(request);
                return Ok(value);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = std::fs::remove_file(request);
        Err("credential prompt timed out".into())
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

pub fn reply(directory: &Path, id: &str, value: &str) -> Result<(), String> {
    std::fs::write(directory.join(format!("{id}.response")), value)
        .map_err(|error| error.to_string())
}
