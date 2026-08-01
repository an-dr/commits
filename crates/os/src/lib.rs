use std::sync::Arc;
use std::thread;

use bus::{Bus, Envelope, Handler, Module, ModuleContext};
use commits_ipc::native::{NativeResult, OsRequest};

pub mod rendezvous;

pub const REQUEST_TOPIC: &str = "os/request";
pub const RESULT_TOPIC: &str = "os/result";
pub const PROMPT_TOPIC: &str = "os/prompt";
pub const PROMPT_RESPONSE_TOPIC: &str = "os/prompt-response";

pub trait OsBackend: Send + Sync {
    fn read_clipboard(&self) -> Result<String, String>;
    fn write_clipboard(&self, value: &str) -> Result<(), String>;
    fn open_url(&self, value: &str) -> Result<(), String>;
    fn pick_file(&self, title: &str) -> Result<Option<String>, String>;
    fn pick_folder(&self, title: &str) -> Result<Option<String>, String>;
}

pub struct SystemOsBackend;

impl OsBackend for SystemOsBackend {
    fn read_clipboard(&self) -> Result<String, String> {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.get_text())
            .map_err(|error| error.to_string())
    }
    fn write_clipboard(&self, value: &str) -> Result<(), String> {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(value))
            .map_err(|error| error.to_string())
    }
    fn open_url(&self, value: &str) -> Result<(), String> {
        if !value.starts_with("https://")
            && !value.starts_with("http://")
            && !value.starts_with("mailto:")
        {
            return Err("unsupported external URL scheme".into());
        }
        open::that(value).map_err(|error| error.to_string())
    }
    fn pick_file(&self, title: &str) -> Result<Option<String>, String> {
        Ok(rfd::FileDialog::new()
            .set_title(title)
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned()))
    }
    fn pick_folder(&self, title: &str) -> Result<Option<String>, String> {
        Ok(rfd::FileDialog::new()
            .set_title(title)
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned()))
    }
}

pub struct OsModule {
    bus: Option<Bus>,
    backend: Arc<dyn OsBackend>,
}

impl OsModule {
    pub fn new(backend: Arc<dyn OsBackend>) -> Self {
        Self { bus: None, backend }
    }

    fn start(&self, request: OsRequest) {
        let Some(bus) = self.bus.clone() else { return };
        let backend = self.backend.clone();
        thread::spawn(move || {
            let result = execute(backend.as_ref(), &request);
            if let Ok(payload) = result.encode() {
                bus.publish(Envelope {
                    topic: RESULT_TOPIC.into(),
                    sender: "os".into(),
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
        if envelope.topic == REQUEST_TOPIC {
            if let Ok(request) = OsRequest::decode(&envelope.payload) {
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
        "os"
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REQUEST_TOPIC);
        context.subscribe(PROMPT_RESPONSE_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.bus
            .as_ref()
            .map(|_| ())
            .ok_or_else(|| "no Bus service available".into())
    }

    fn render(&mut self) {
        let Some(bus) = self.bus.as_ref() else { return };
        let Ok(entries) = std::fs::read_dir(prompt_directory()) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|extension| extension == "request") {
                if let (Some(id), Ok(body)) = (path.file_stem().and_then(|value| value.to_str()), std::fs::read_to_string(&path)) {
                    let payload = format!("{id}\n{body}").into_bytes();
                    bus.publish(Envelope { topic: PROMPT_TOPIC.into(), sender: "os".into(), correlation: None, payload });
                }
            }
        }
    }
}

fn prompt_directory() -> std::path::PathBuf {
    std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.join("saves/prompts"))).unwrap_or_else(|| std::path::PathBuf::from("saves/prompts"))
}

fn execute(backend: &dyn OsBackend, request: &OsRequest) -> NativeResult {
    let outcome = match request.action {
        0 => backend.read_clipboard().map(Some),
        1 => backend
            .write_clipboard(&request.value)
            .map(|_| Some(String::new())),
        2 => backend
            .open_url(&request.value)
            .map(|_| Some(String::new())),
        3 => backend.pick_file(&request.value),
        4 => backend.pick_folder(&request.value),
        _ => Err("unknown OS action".into()),
    };
    match outcome {
        Ok(value) => NativeResult {
            request_id: request.request_id,
            accepted: value.is_some(),
            value: value.unwrap_or_default(),
            error: String::new(),
        },
        Err(error) => NativeResult {
            request_id: request.request_id,
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
