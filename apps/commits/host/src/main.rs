// Release builds are a desktop app, so Windows must not open a console behind
// the window. Debug builds keep the console, which is where their logs go.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commits_repo;
mod diagnostics;
mod page;
mod settings;
mod splash;
mod updater;

use std::sync::mpsc::Receiver;

fn main() {
    if let Err(error) = run() {
        eprintln!("fatal: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let (logger, failures) = diagnostics::install();
    watch_startup_health(failures);
    let page = page::PageModule::new(logger.clone());
    let splash = splash::SplashModule::new(logger.clone());
    runner::Engine::new()
        .logger(logger)
        // `commits.wasm` is ~12 MB carrying an embedded JavaScript engine, so
        // `instantiate` + `init` needs far more than the engine's one second
        // default. The budget is wall clock: a cold file, a virus scanner
        // reading a freshly written binary, or a machine still busy from the
        // build all spend it without the component doing anything wrong, and
        // overrunning it traps `init` rather than retrying (BUG-002).
        .extension_load_timeout(std::time::Duration::from_secs(30))
        // Opening a repository reads and shapes its whole history inside a
        // single `on-message`, which the engine's 50ms per-call default
        // treats as a runaway: the extension traps, is quarantined, and the
        // panel goes black mid-session. The work is real, so it gets a real
        // budget -- still bounded, because a call this long does block the
        // window (BUG-003).
        .extension_call_timeout(std::time::Duration::from_secs(20))
        .extensions_dir("extensions")
        .startup_extension("commits")
        .saves_dir("saves")
        .window("commits", 1100, 720)
        .web()
        // Modules init in registration order, so these two come first: the
        // page server has to be listening before the splash can ask it for a
        // URL, and the loading page wants to be up before the slower modules
        // and the component's own load run.
        .module(page)
        .module(splash)
        .module(commits_git::GitModule::default())
        .module(commits_watcher::WatcherModule::default())
        .module(commits_os::OsModule::default())
        .module(settings::SettingsModule::default())
        .module(commits_repo::CommitsRepoModule::default())
        .module(updater::UpdaterModule::default())
        .run()?;
    Ok(())
}

/// Turns a failed startup extension into something the user can act on, and
/// tells `commits-launcher` (if that is what started this process) that
/// startup succeeded.
///
/// The engine treats an extension that cannot attach as non-fatal: it logs the
/// error and keeps ticking. Nothing then opens the panel, so the window stays
/// blank with no hint that anything went wrong. The common cause is a busy or
/// cold machine pushing `instantiate` + `init` past the engine's one second
/// load budget, which relaunching usually clears -- worth saying out loud,
/// because a blank window looks like a broken build rather than a retryable
/// timeout.
///
/// A launcher supervising this process for a self-update needs to know
/// startup actually succeeded, not just that this line of code ran, so the
/// health marker (`COMMITS_HEALTH_MARKER`) is written only after this same
/// grace period passes with no failure on `failures` -- the one channel that
/// already knows about the blank-window failure mode above. Launched
/// directly (the ordinary case today), `COMMITS_HEALTH_MARKER` is unset and
/// this is a no-op past the existing failure-reporting behavior.
///
/// Waits on its own thread: the report has to arrive while the engine is still
/// running its loop, not after it returns.
fn watch_startup_health(failures: Receiver<String>) {
    // Longer than `extension_load_timeout` (30s, set in `run()` below) so a
    // genuine cold-load failure has time to arrive on `failures` before this
    // would otherwise conclude the app is healthy. Discovered empirically:
    // an initial 5s grace period made the launcher roll back a perfectly
    // good, merely slow-to-load install.
    const STARTUP_GRACE_PERIOD: std::time::Duration = std::time::Duration::from_secs(35);
    let spawned = std::thread::Builder::new()
        .name("commits-startup-report".to_string())
        .spawn(move || {
            let message = match failures.recv_timeout(STARTUP_GRACE_PERIOD) {
                Ok(message) => message,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    write_health_marker();
                    return;
                }
                // The engine shut down without failing -- the ordinary path,
                // needing no report and no marker (the app is exiting anyway).
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            };
            let log = diagnostics::log_path()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| String::from("(could not resolve the log path)"));
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("commits could not start")
                .set_description(format!(
                    "The commits extension did not load, so the window stays blank.\n\n\
                     This is usually a machine too busy for the engine's one second \
                     component load budget rather than a broken build. Starting commits \
                     again normally succeeds.\n\n\
                     Details were written to:\n{log}\n\n{message}"
                ))
                .show();
            std::process::exit(1);
        });
    if let Err(error) = spawned {
        eprintln!("could not watch for a failed startup extension: {error}");
    }
}

/// Writes an empty file at `COMMITS_HEALTH_MARKER`, if set. A write failure
/// (missing parent directory, no permission) is logged, not fatal: the
/// worst outcome is `commits-launcher` treating a genuinely healthy start as
/// failed and rolling back to the previous version, never the app itself
/// misbehaving.
fn write_health_marker() {
    let Ok(path) = std::env::var("COMMITS_HEALTH_MARKER") else {
        return;
    };
    if let Err(error) = std::fs::write(&path, []) {
        eprintln!("could not write the health marker at {path}: {error}");
    }
}
