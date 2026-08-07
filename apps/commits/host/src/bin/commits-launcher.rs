//! Permanent entry point for a self-updating install: applies any staged,
//! already-verified update before the real app can possibly be holding its
//! own files open, launches it, and rolls back to the previous version if it
//! does not report itself healthy in time. See `crates/upgrader` for why
//! this crate is not named "updater".

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
const MAIN_EXE_NAME: &str = "commits.exe";
#[cfg(not(windows))]
const MAIN_EXE_NAME: &str = "commits";

#[cfg(windows)]
const LAUNCHER_EXE_NAME: &str = "commits-launcher.exe";
#[cfg(not(windows))]
const LAUNCHER_EXE_NAME: &str = "commits-launcher";

/// How long the launcher waits for the health marker before concluding the
/// new version failed to start. Comfortably longer than the app's own
/// 35-second startup grace period (`watch_startup_health` in `main.rs`,
/// itself sized to the engine's 30-second cold WASM-extension load budget),
/// to leave room for process-spawn overhead and marker-file propagation.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(45);
const POLL_INTERVAL: Duration = Duration::from_millis(200);

fn main() {
    let Some(install_dir) = std::env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf)) else {
        eprintln!("could not resolve the launcher's own directory");
        std::process::exit(1);
    };
    let Some(state_dir) = commits_upgrader::state_dir() else {
        eprintln!("could not resolve the home directory for update state");
        std::process::exit(1);
    };
    let update_dir = state_dir.join("update");
    let backup_dir = state_dir.join("backup");

    if update_dir.is_dir() {
        // The launcher's own exe is never part of an update payload and can
        // never be overwritten by anything anyway while it is running this
        // code, so it is excluded from both the backup and the apply copy.
        if let Err(error) =
            commits_upgrader::apply(&install_dir, &update_dir, &backup_dir, &[LAUNCHER_EXE_NAME])
        {
            // A failed apply must never block the app from starting at all:
            // the previous, presumably-working install is still in place.
            eprintln!("could not apply the staged update: {error}");
        }
    }

    launch_and_supervise(&install_dir, &backup_dir);
}

fn launch_and_supervise(install_dir: &Path, backup_dir: &Path) {
    let exe = install_dir.join(MAIN_EXE_NAME);
    match spawn_and_confirm_healthy(&exe) {
        // Healthy: leave it running detached. A Windows child outlives its
        // parent by default, so the launcher exiting here does not affect it.
        Ok(_child) if wait_for_health() => return,
        Ok(mut child) => {
            eprintln!("commits did not report healthy within the timeout; rolling back");
            let _ = child.kill();
            let _ = child.wait();
        }
        Err(error) => eprintln!("could not launch {}: {error}", exe.display()),
    }

    if let Err(error) = restore_backup_with_retry(install_dir, backup_dir) {
        eprintln!("could not restore the backup: {error}");
        return;
    }
    // One relaunch of the restored version, without supervising it again --
    // if a previously-working version still fails, that is a deeper problem
    // than a startup health check is meant to solve.
    if let Err(error) = spawn_detached(&exe, None) {
        eprintln!("could not relaunch the restored version: {error}");
    }
}

/// `restore_backup`, retrying on failure: `Child::wait()` confirms the OS
/// has reaped the just-killed process, but that alone does not guarantee
/// every file it had open (e.g. one being scanned by antivirus at that
/// moment) is instantly writable again. A short retry loop is the standard
/// mitigation for that kind of transient lock. It does *not* cover the
/// launcher's own exe -- that one can never be overwritten while running no
/// matter how long this retries, which is why it is excluded entirely via
/// `LAUNCHER_EXE_NAME` rather than retried (a real test of this caught that
/// distinction the hard way: retrying up to 20 seconds never once helped
/// when the excluded-file fix was still missing).
fn restore_backup_with_retry(install_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    const ATTEMPTS: u32 = 10;
    const RETRY_DELAY: Duration = Duration::from_millis(300);
    let mut last_error = String::new();
    for attempt in 0..ATTEMPTS {
        match commits_upgrader::restore_backup(install_dir, backup_dir, &[LAUNCHER_EXE_NAME]) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
        if attempt + 1 < ATTEMPTS {
            std::thread::sleep(RETRY_DELAY);
        }
    }
    Err(last_error)
}

/// Spawns `exe` with a fresh marker path and returns the child so the
/// caller can kill and reap it if [`wait_for_health`] reports it unhealthy.
fn spawn_and_confirm_healthy(exe: &Path) -> std::io::Result<Child> {
    let marker_path = health_marker_path();
    let _ = std::fs::remove_file(&marker_path);
    spawn_detached(exe, Some(&marker_path))
}

/// Waits up to [`HEALTH_TIMEOUT`] for the just-spawned child's health
/// marker to appear (its path is this launcher process's own pid, so no
/// parameter is needed to line it up with the spawn in
/// [`spawn_and_confirm_healthy`]).
fn wait_for_health() -> bool {
    let marker_path = health_marker_path();
    let start = Instant::now();
    let healthy = commits_upgrader::wait_for_marker(
        || marker_path.exists(),
        || start.elapsed(),
        || std::thread::sleep(POLL_INTERVAL),
        HEALTH_TIMEOUT,
    );
    let _ = std::fs::remove_file(&marker_path);
    healthy
}

/// One marker path per launcher process: stable across the two calls above
/// (spawn, then wait) without threading an extra parameter through them.
fn health_marker_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("commits-health-{}.marker", std::process::id()))
}

/// Spawns `exe` with its own fresh stdio rather than inheriting the
/// launcher's: a detached GUI child that outlives the launcher would
/// otherwise keep the launcher's stdout/stderr handles open for as long as
/// it keeps running, which is indefinite -- observed directly while testing
/// this, where a caller redirecting the launcher's stderr to a file hung
/// waiting for that file's handle count to reach zero long after the
/// launcher process itself had exited.
fn spawn_detached(exe: &Path, marker_path: Option<&Path>) -> std::io::Result<Child> {
    let mut command = Command::new(exe);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(marker_path) = marker_path {
        command.env("COMMITS_HEALTH_MARKER", marker_path);
    }
    command.spawn()
}

