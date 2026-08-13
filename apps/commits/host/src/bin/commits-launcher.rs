//! Permanent entry point for a self-updating install: picks the current
//! version folder under its own install dir, launches it, and -- if it does
//! not report itself healthy in time -- deletes that version folder and
//! falls back to the previous one, which installing the failed version
//! never touched. See `crates/upgrader` for why this crate is not named
//! "updater", and `docs/updating.md` for the version-folder layout.

// Same reasoning as main.rs: a release build is a desktop entry point, not a
// console tool, so Windows must not open a terminal behind it. Debug builds
// keep the console, which is where this file's eprintln! output goes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
const MAIN_EXE_NAME: &str = "commits-app.exe";
#[cfg(not(windows))]
const MAIN_EXE_NAME: &str = "commits-app";

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
    // Everything after the launcher's own name belongs to the app, not to
    // the launcher: this process is a supervisor that happens to be the name
    // users type, so `commits C:/repo` has to reach `commits-app` unread.
    // The launcher deliberately interprets nothing, so a future app argument
    // needs no change here.
    let app_args: Vec<String> = std::env::args().skip(1).collect();
    launch_and_supervise(&install_dir, &app_args);
}

fn launch_and_supervise(install_dir: &Path, app_args: &[String]) {
    let Some(version_dir) = commits_upgrader::current_version_dir(install_dir) else {
        eprintln!("no version is installed under {}", install_dir.display());
        std::process::exit(1);
    };
    let exe = version_dir.join(MAIN_EXE_NAME);
    match spawn_and_confirm_healthy(&exe, app_args) {
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

    let Some(previous_dir) = commits_upgrader::previous_version_dir(install_dir) else {
        eprintln!("{} failed its health check and there is no previous version to fall back to", version_dir.display());
        return;
    };
    // The failed version must be removed, not merely ignored: it is still
    // the highest version on disk, so leaving it in place would make the
    // very next start pick it again and fail the same way forever instead
    // of ever reaching `previous_dir`.
    if let Err(error) = remove_version_dir_with_retry(&version_dir) {
        eprintln!("could not remove the failed version {}: {error}", version_dir.display());
    }
    // One relaunch of the previous version, without supervising it again --
    // if a previously-working version still fails, that is a deeper problem
    // than a startup health check is meant to solve.
    // The fallback runs the same command the user typed: rolling back a
    // version must not also drop the repository they asked to open.
    if let Err(error) = spawn_detached(&previous_dir.join(MAIN_EXE_NAME), None, app_args) {
        eprintln!("could not relaunch the previous version: {error}");
    }
}

/// `remove_version_dir`, retrying on failure: `Child::wait()` confirms the OS
/// has reaped the just-killed process, but that alone does not guarantee
/// every file it had open (e.g. one being scanned by antivirus at that
/// moment, or its own WebView2 profile) is instantly removable. A short
/// retry loop is the standard mitigation for that kind of transient lock.
fn remove_version_dir_with_retry(version_dir: &Path) -> Result<(), String> {
    const ATTEMPTS: u32 = 10;
    const RETRY_DELAY: Duration = Duration::from_millis(300);
    let mut last_error = String::new();
    for attempt in 0..ATTEMPTS {
        match commits_upgrader::remove_version_dir(version_dir) {
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
fn spawn_and_confirm_healthy(exe: &Path, app_args: &[String]) -> std::io::Result<Child> {
    let marker_path = health_marker_path();
    let _ = std::fs::remove_file(&marker_path);
    spawn_detached(exe, Some(&marker_path), app_args)
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
fn spawn_detached(exe: &Path, marker_path: Option<&Path>, app_args: &[String]) -> std::io::Result<Child> {
    let mut command = Command::new(exe);
    command.args(app_args);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(marker_path) = marker_path {
        command.env("COMMITS_HEALTH_MARKER", marker_path);
    }
    command.spawn()
}
