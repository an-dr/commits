use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bones_engine::bus::{Bus, Envelope, Handler, Module, ModuleContext, ServiceRegistry};
use commits_ipc::native::WatchRequest;
use notify::event::AccessKind;
use notify::EventKind;
use tempfile::tempdir;

use crate::{
    is_interesting, is_refresh_worthy, resolve_metadata_paths, WatcherModule, FULL_TOPIC,
    LIGHTWEIGHT_TOPIC, REQUEST_TOPIC,
};

#[test]
fn resolves_directory_git_metadata() {
    let temp = tempdir().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    assert_eq!(
        resolve_metadata_paths(temp.path()).unwrap(),
        vec![fs::canonicalize(temp.path().join(".git")).unwrap()]
    );
}

#[test]
fn resolves_linked_gitdir_and_commondir() {
    let temp = tempdir().unwrap();
    let worktree = temp.path().join("worktree");
    let git_dir = temp.path().join("meta/worktrees/one");
    fs::create_dir_all(&worktree).unwrap();
    fs::create_dir_all(&git_dir).unwrap();
    fs::write(worktree.join(".git"), "gitdir: ../meta/worktrees/one\n").unwrap();
    fs::write(git_dir.join("commondir"), "../..\n").unwrap();
    assert_eq!(
        resolve_metadata_paths(&worktree).unwrap(),
        vec![
            fs::canonicalize(git_dir).unwrap(),
            fs::canonicalize(temp.path().join("meta")).unwrap()
        ]
    );
}

#[test]
fn rejects_an_invalid_git_file() {
    let temp = tempdir().unwrap();
    fs::write(temp.path().join(".git"), "not a pointer").unwrap();
    assert!(resolve_metadata_paths(temp.path()).is_err());
}

#[test]
fn build_output_and_git_objects_are_not_worth_reporting() {
    assert!(!is_interesting(Path::new("C:/repo/target/debug/app.exe")));
    assert!(!is_interesting(Path::new(
        "C:/repo/node_modules/pkg/index.js"
    )));
    assert!(!is_interesting(Path::new("C:/repo/dist/app/commits.exe")));
    assert!(!is_interesting(Path::new("C:/repo/.git/objects/ab/cdef")));
    assert!(!is_interesting(Path::new("C:/repo/.git/lfs/objects/x")));
}

#[test]
fn source_and_refs_are_worth_reporting() {
    assert!(is_interesting(Path::new("C:/repo/src/main.rs")));
    assert!(is_interesting(Path::new("C:/repo/.git/HEAD")));
    assert!(is_interesting(Path::new("C:/repo/.git/refs/heads/main")));
    // "objects" only counts directly under .git, not as an ordinary folder.
    assert!(is_interesting(Path::new("C:/repo/src/objects/model.rs")));
}

#[test]
fn access_only_events_do_not_trigger_a_refresh() {
    assert!(!is_refresh_worthy(EventKind::Access(AccessKind::Read)));
    assert!(is_refresh_worthy(EventKind::Any));
}

#[test]
fn a_burst_of_writes_is_reported_once() {
    let temp = tempdir().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    let (bus, topics, _module) = start_watching(temp.path(), 7);

    // What one `git commit` looks like from here: several metadata writes and a
    // worktree touch, all inside the quiet period.
    fs::write(temp.path().join("work.txt"), "changed").unwrap();
    fs::write(temp.path().join(".git/index"), "x").unwrap();
    fs::write(temp.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::write(temp.path().join(".git/COMMIT_EDITMSG"), "message").unwrap();

    let events = collect_for(&bus, &topics, Duration::from_millis(1_200));
    assert_eq!(
        events.iter().filter(|topic| *topic == FULL_TOPIC).count(),
        1,
        "expected one coalesced full refresh, got {events:?}"
    );
}

#[test]
fn a_worktree_change_alone_asks_only_for_a_lightweight_refresh() {
    let temp = tempdir().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    let (bus, topics, _module) = start_watching(temp.path(), 8);

    fs::write(temp.path().join("work.txt"), "changed").unwrap();

    let events = collect_until(&bus, &topics, Duration::from_secs(5), |events| {
        events.iter().any(|topic| topic == LIGHTWEIGHT_TOPIC)
            || events.iter().any(|topic| topic == FULL_TOPIC)
    });
    assert!(events.iter().any(|topic| topic == LIGHTWEIGHT_TOPIC));
    assert!(!events.iter().any(|topic| topic == FULL_TOPIC));
}

#[test]
fn a_build_writing_into_target_is_never_reported() {
    let temp = tempdir().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
    fs::create_dir(temp.path().join("target")).unwrap();
    let (bus, topics, _module) = start_watching(temp.path(), 9);

    for i in 0..50 {
        fs::write(temp.path().join(format!("target/artifact{i}.o")), "bytes").unwrap();
    }

    let events = collect_for(&bus, &topics, Duration::from_millis(800));
    assert!(
        events.is_empty(),
        "build churn reached the guest: {events:?}"
    );
}

/// Starts a watch on `repository` and returns the bus plus the topics seen.
fn start_watching(
    repository: &Path,
    request_id: u32,
) -> (Bus, Arc<Mutex<Vec<String>>>, WatcherModule) {
    let bus = Bus::new();
    let mut services = ServiceRegistry::new();
    services.provide(bus.clone()).unwrap();
    let mut module = WatcherModule::new();
    module.init(&mut ModuleContext::new(&mut services)).unwrap();
    let topics = Arc::new(Mutex::new(Vec::<String>::new()));
    let output = topics.clone();
    let endpoint = bus.register("test", move |event: &Envelope| {
        output.lock().unwrap().push(event.topic.clone());
    });
    endpoint.subscribe("repo/*");
    module.handle(&Envelope {
        topic: REQUEST_TOPIC.into(),
        sender: "test".into(),
        correlation: Some(u64::from(request_id)),
        payload: WatchRequest {
            request_id,
            action: 0,
            repository: repository.to_string_lossy().into_owned(),
        }
        .encode()
        .unwrap(),
    });
    (bus, topics, module)
}

/// Pumps the bus for `window`, which must outlast the coalescing quiet period.
fn collect_for(bus: &Bus, topics: &Arc<Mutex<Vec<String>>>, window: Duration) -> Vec<String> {
    collect_until(bus, topics, window, |_| false)
}

/// Pumps the bus until `done` observes the expected event or the timeout expires.
fn collect_until(
    bus: &Bus,
    topics: &Arc<Mutex<Vec<String>>>,
    timeout: Duration,
    done: impl Fn(&[String]) -> bool,
) -> Vec<String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
        bus.dispatch();
        let events = topics.lock().unwrap();
        if done(&events) {
            return events.clone();
        }
    }
    topics.lock().unwrap().clone()
}
