use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use bones_engine::bus::{Bus, Envelope, Handler, Module, ModuleContext, ServiceRegistry};
use commits_ipc::native::{NativeResult, OsRequest};

use crate::{OsBackend, OsModule, REQUEST_TOPIC, RESULT_TOPIC};

#[derive(Default)]
struct StubBackend {
    clipboard: Mutex<String>,
}

impl OsBackend for StubBackend {
    fn read_clipboard(&self) -> Result<String, String> {
        Ok(self.clipboard.lock().unwrap().clone())
    }
    fn write_clipboard(&self, value: &str) -> Result<(), String> {
        *self.clipboard.lock().unwrap() = value.into();
        Ok(())
    }
    fn open_url(&self, value: &str) -> Result<(), String> {
        value
            .starts_with("https://")
            .then_some(())
            .ok_or("unsafe URL".into())
    }
    fn open_directory(&self, path: &str) -> Result<(), String> {
        path.starts_with("C:/").then_some(()).ok_or("not a directory".into())
    }
    fn pick_file(&self, _title: &str) -> Result<Option<String>, String> {
        Ok(Some("C:/chosen.txt".into()))
    }
    fn pick_folder(&self, _title: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn read_file(&self, request: &str) -> Result<Option<String>, String> {
        Ok(Some(request.replace('\n', ":")))
    }
    fn fetch_url(&self, url: &str) -> Result<Option<String>, String> {
        if url == "https://example.com/missing" {
            return Ok(None);
        }
        url.starts_with("https://")
            .then(|| Some("image/png;base64,c3R1Yg==".to_string()))
            .ok_or("only https URLs may be fetched".into())
    }
}

#[test]
fn publishes_results_for_every_capability() {
    let bus = Bus::new();
    let mut services = ServiceRegistry::new();
    services.provide(bus.clone()).unwrap();
    let mut module = OsModule::new(Arc::new(StubBackend::default()));
    module.init(&mut ModuleContext::new(&mut services)).unwrap();
    let results = Arc::new(Mutex::new(Vec::<NativeResult>::new()));
    let output = results.clone();
    let endpoint = bus.register("test", move |event: &Envelope| {
        output
            .lock()
            .unwrap()
            .push(NativeResult::decode(&event.payload).unwrap());
    });
    endpoint.subscribe(RESULT_TOPIC);

    for (request_id, action, value) in [
        (1, 1, "copied"),
        (2, 0, ""),
        (3, 2, "https://example.com"),
        (4, 3, "file"),
        (5, 4, "folder"),
        (6, 2, "file:///private"),
        (7, 6, "C:/repo"),
        (8, 6, "not-a-directory"),
        (9, 7, "https://example.com/avatar.png"),
    ] {
        module.handle(&Envelope {
            topic: REQUEST_TOPIC.into(),
            sender: "test".into(),
            correlation: Some(request_id.into()),
            payload: OsRequest {
                request_id,
                action,
                value: value.into(),
            }
            .encode()
            .unwrap(),
        });
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while results.lock().unwrap().len() < 9 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
        bus.dispatch();
    }
    let results = results.lock().unwrap();
    assert_eq!(results.len(), 9);
    assert!(results
        .iter()
        .any(|result| result.request_id == 1 && result.accepted));
    assert!(results.iter().any(|result| result.request_id == 2));
    assert!(results.iter().any(|result| result.value == "C:/chosen.txt"));
    assert!(results
        .iter()
        .any(|result| result.request_id == 5 && !result.accepted));
    assert!(results
        .iter()
        .any(|result| result.request_id == 6 && result.error == "unsafe URL"));
    assert!(results
        .iter()
        .any(|result| result.request_id == 7 && result.accepted));
    assert!(results
        .iter()
        .any(|result| result.request_id == 8 && result.error == "not a directory"));
    assert!(results
        .iter()
        .any(|result| result.request_id == 9 && result.value == "image/png;base64,c3R1Yg=="));
}

/// The read is confined to one repository, and an unreadable entry inside it is
/// absent rather than an error, which is how a working-tree file behaves.
#[test]
fn reads_only_text_files_inside_the_repository() {
    let root = std::env::temp_dir().join(format!("commits-os-read-{}", std::process::id()));
    let nested = root.join("src");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(nested.join("file.txt"), "one\ntwo\n").unwrap();
    std::fs::write(nested.join("binary.bin"), [0u8, 159, 146, 150]).unwrap();
    let outside = std::env::temp_dir().join(format!("commits-os-outside-{}.txt", std::process::id()));
    std::fs::write(&outside, "secret").unwrap();
    let backend = crate::SystemOsBackend;
    let request = |path: &str| format!("{}\n{}", root.display(), path);

    assert_eq!(
        backend.read_file(&request("src/file.txt")).unwrap(),
        Some("one\ntwo\n".into())
    );
    assert_eq!(backend.read_file(&request("src/missing.txt")).unwrap(), None);
    assert_eq!(backend.read_file(&request("src/binary.bin")).unwrap(), None);
    assert_eq!(backend.read_file(&request("src")).unwrap(), None);
    assert!(backend
        .read_file(&request(&format!("../{}", outside.file_name().unwrap().to_string_lossy())))
        .is_err());
    assert!(backend.read_file("no-newline-separator").is_err());

    std::fs::remove_dir_all(&root).ok();
    std::fs::remove_file(&outside).ok();
}

#[test]
fn decodes_a_fetch_result_back_into_content_type_and_bytes() {
    let value = format!(
        "image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(b"hello")
    );
    let (content_type, bytes) = crate::decode_fetch_result(&value).unwrap();
    assert_eq!(content_type, "image/png");
    assert_eq!(bytes, b"hello");

    assert!(crate::decode_fetch_result("not-the-right-shape").is_err());
    assert!(crate::decode_fetch_result("image/png;base64,not valid base64!!").is_err());
}
