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
    fn find_repositories(&self, path: &str) -> Result<Option<String>, String> {
        Ok((path == "C:/code").then(|| String::from("C:/code/alpha\nC:/code/beta")))
    }
    fn run_tool(&self, request: &str) -> Result<(), String> {
        crate::parse_tool_run(request).map(|_| ())
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
        (10, 8, "C:/code"),
        (11, 9, "code\n\n\n\n\nC:/repo"),
        (12, 9, ""),
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
    while results.lock().unwrap().len() < 12 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
        bus.dispatch();
    }
    let results = results.lock().unwrap();
    assert_eq!(results.len(), 12);
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
    assert!(results
        .iter()
        .any(|result| result.request_id == 10 && result.value == "C:/code/alpha\nC:/code/beta"));
    assert!(results
        .iter()
        .any(|result| result.request_id == 11 && result.accepted));
    // A run naming no program is refused rather than started, since the empty
    // string would otherwise reach the OS as a program name.
    assert!(results
        .iter()
        .any(|result| result.request_id == 12 && !result.accepted));
}

/// The framing is positional, so the parser is what keeps a tool's arguments
/// from being read as one of the diff fields, or the other way round.
#[test]
fn reads_a_tool_run_from_its_lines() {
    let run = crate::parse_tool_run("code\n\n\n\n\n-n\nC:/repo").unwrap();
    assert_eq!(run.program, "code");
    assert_eq!(run.args, vec!["-n".to_string(), "C:/repo".to_string()]);
    assert!(run.left.is_none() && run.right.is_none());

    let diff = crate::parse_tool_run("code\na.ts\nYQ==\na.ts\nYg==\n--diff\n{left}\n{right}").unwrap();
    assert_eq!(diff.left.as_ref().map(|blob| blob.base64.as_str()), Some("YQ=="));
    assert_eq!(diff.right.as_ref().map(|blob| blob.base64.as_str()), Some("Yg=="));
    assert_eq!(diff.args.len(), 3);

    assert!(crate::parse_tool_run("").is_err());
}

/// The two revisions of a file usually share a name, so each side needs its own
/// directory; the placeholders are only useful once they name real paths.
#[test]
fn writes_both_diff_sides_and_substitutes_their_paths() {
    let directory = tempfile::tempdir().unwrap();
    let run = crate::parse_tool_run("code\na.ts\nYQ==\na.ts\nYg==\n--diff\n{left}\n{right}").unwrap();

    let args = crate::materialize_tool_args(&run, directory.path()).unwrap();

    assert_eq!(args[0], "--diff");
    assert_ne!(args[1], args[2]);
    assert_eq!(std::fs::read_to_string(&args[1]).unwrap(), "a");
    assert_eq!(std::fs::read_to_string(&args[2]).unwrap(), "b");
    assert!(args[1].ends_with("a.ts") && args[2].ends_with("a.ts"));
}

/// A name arrives from the page, so it is treated as a name rather than a path:
/// anything that looks like one is reduced to its last component.
#[test]
fn keeps_a_crafted_file_name_inside_the_temporary_directory() {
    let directory = tempfile::tempdir().unwrap();
    let run = crate::parse_tool_run("code\n../../escaped.txt\nYQ==\n\n\n{left}").unwrap();

    let args = crate::materialize_tool_args(&run, directory.path()).unwrap();

    assert!(std::path::Path::new(&args[0]).starts_with(directory.path()));
    assert!(args[0].ends_with("escaped.txt"));
}

/// Opening a repository has no diff sides, so nothing is written and the
/// arguments reach the tool exactly as configured.
#[test]
fn leaves_a_run_without_diff_sides_untouched() {
    let directory = tempfile::tempdir().unwrap();
    let run = crate::parse_tool_run("code\n\n\n\n\n-n\nC:/repo").unwrap();

    let args = crate::materialize_tool_args(&run, directory.path()).unwrap();

    assert_eq!(args, vec!["-n".to_string(), "C:/repo".to_string()]);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

/// A tool that is not installed must be reported, not swallowed: the user gets
/// no window either way, and only the error says why.
#[test]
fn reports_a_program_that_cannot_be_started() {
    let backend = crate::SystemOsBackend;
    let outcome = <crate::SystemOsBackend as OsBackend>::run_tool(
        &backend,
        "commits-no-such-program-3f9a\n\n\n\n\n--version",
    );

    assert!(outcome.is_err());
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
