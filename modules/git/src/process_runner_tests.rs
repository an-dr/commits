use std::sync::atomic::AtomicBool;

use commits_ipc::native::GitRun;

use crate::process_runner::ProcessRunner;

fn request(args: &[&str]) -> GitRun {
    GitRun {
        request_id: 42,
        cwd: env!("CARGO_MANIFEST_DIR").into(),
        args: args.iter().map(|value| (*value).into()).collect(),
        env: vec![("LANG".into(), "C".into())],
        timeout_ms: 10_000,
    }
}

#[test]
fn returns_real_git_version_output() {
    let result = ProcessRunner::git(2).run(&request(&["--version"]), &AtomicBool::new(false));
    assert_eq!(result.status, 0);
    assert_eq!(result.exit_code, 0);
    assert!(String::from_utf8_lossy(&result.stdout).starts_with("git version"));
    assert!(result.stderr.is_empty());
}

#[test]
fn reports_nonzero_exit_and_stderr() {
    let result = ProcessRunner::git(1).run(
        &request(&["rev-parse", "--verify", "refs/does-not-exist"]),
        &AtomicBool::new(false),
    );
    assert_eq!(result.status, 0);
    assert_ne!(result.exit_code, 0);
    assert!(!result.stderr.is_empty());
}

#[test]
fn honours_preexisting_cancellation() {
    let result = ProcessRunner::git(1).run(&request(&["status"]), &AtomicBool::new(true));
    assert_eq!(result.status, 1);
}

#[test]
fn reports_spawn_failures_without_panicking() {
    let result = ProcessRunner::new("missing-commits-test-executable", 1)
        .run(&request(&[]), &AtomicBool::new(false));
    assert_eq!(result.status, 2);
    assert_eq!(result.exit_code, -1);
    assert!(!result.stderr.is_empty());
}
