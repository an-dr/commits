use std::time::Duration;

use tempfile::tempdir;

use crate::rendezvous::{reply, Prompt};

#[test]
fn exchanges_a_prompt_response_without_network_access() {
    let directory = tempdir().unwrap();
    let prompt = Prompt::create(directory.path(), "askpass", "Password:").unwrap();
    let id = prompt.id().to_owned();
    reply(directory.path(), &id, "secret").unwrap();
    assert_eq!(prompt.wait(Duration::from_millis(50)).unwrap(), "secret");
}

#[test]
fn removes_a_timed_out_request() {
    let directory = tempdir().unwrap();
    let prompt = Prompt::create(directory.path(), "editor", "message").unwrap();
    let id = prompt.id().to_owned();
    assert!(prompt.wait(Duration::from_millis(10)).is_err());
    assert!(!directory.path().join(format!("{id}.request")).exists());
}
