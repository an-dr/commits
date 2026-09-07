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

/// The wedge this avoids: `commits-askpass` inherits the command's pipes and
/// keeps them open while it waits for an answer, which outlives the command
/// itself. Reading to end of file held a runner slot for that whole wait --
/// four such pushes and no Git command ran again.
#[cfg(unix)]
#[test]
fn output_is_not_waited_on_past_the_command_that_produced_it() {
    // `sh` exits immediately, while the process it backgrounded holds stdout
    // open for far longer, exactly as askpass does.
    let started = std::time::Instant::now();

    let result = ProcessRunner::new("sh", 1).run(
        &request(&["-c", "sleep 6 & echo done; echo problem >&2"]),
        &AtomicBool::new(false),
    );

    assert_eq!(result.exit_code, 0);
    assert_eq!(result.stdout, b"done\n");
    assert_eq!(result.stderr, b"problem\n");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "held the slot for {:?}",
        started.elapsed()
    );
}

#[test]
fn reports_spawn_failures_without_panicking() {
    let result = ProcessRunner::new("missing-commits-test-executable", 1)
        .run(&request(&[]), &AtomicBool::new(false));
    assert_eq!(result.status, 2);
    assert_eq!(result.exit_code, -1);
    assert!(!result.stderr.is_empty());
}
