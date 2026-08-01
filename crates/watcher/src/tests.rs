use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bus::{Bus, Envelope, Handler, Module, ModuleContext, ServiceRegistry};
use commits_ipc::native::WatchRequest;
use tempfile::tempdir;

use crate::{resolve_metadata_paths, WatcherModule, FULL_TOPIC, LIGHTWEIGHT_TOPIC, REQUEST_TOPIC};

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
fn file_touches_publish_the_expected_refresh_topics() {
    let temp = tempdir().unwrap();
    fs::create_dir(temp.path().join(".git")).unwrap();
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
        correlation: Some(3),
        payload: WatchRequest {
            request_id: 3,
            action: 0,
            repository: temp.path().to_string_lossy().into_owned(),
        }
        .encode()
        .unwrap(),
    });

    fs::write(temp.path().join("work.txt"), "changed").unwrap();
    fs::write(temp.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
        bus.dispatch();
        let events = topics.lock().unwrap();
        if events.iter().any(|topic| topic == FULL_TOPIC)
            && events.iter().any(|topic| topic == LIGHTWEIGHT_TOPIC)
        {
            return;
        }
    }
    panic!("missing watcher events: {:?}", topics.lock().unwrap());
}
