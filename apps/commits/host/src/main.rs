// Release builds are a desktop app, so Windows must not open a console behind
// the window. Debug builds keep the console, which is where their logs go.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commits_repo;
mod diagnostics;
mod launch;
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
    satisfy_legacy_launcher();
    watch_startup_failure(failures);
    refresh_launcher(&logger);
    let page = page::PageModule::new(logger.clone());
    let splash = splash::SplashModule::new(logger.clone());
    bones_engine::Engine::new()
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
        // Components are versioned along with the rest of the app -- plain
        // exe-relative resolution already means "inside my own version
        // folder", exactly where dist.ps1/install.ps1 place them. State is
        // different: it must survive an update, so it resolves to the
        // shared, install-wide location one level up (see
        // commits_upgrader::shared_or_exe_relative) rather than being
        // siloed inside whichever version folder happens to be running.
        // Named "components"/"state" rather than bones' own
        // "extensions"/"states" defaults -- this app's own vocabulary,
        // distinct from the engine's.
        .extensions_dir("components")
        .startup_extension("commits")
        .saves_dir(shared_data_dir("state"))
        .window("commits", 1200, 1000)
        .min_window_size(1200, 800)
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
        .module(launch::LaunchModule::default())
        .module(updater::UpdaterModule::default())
        .run()?;
    Ok(())
}

/// Resolves `name` for the engine builder's `saves_dir`: see
/// `commits_upgrader::shared_or_exe_relative` for why this needs to be
/// install-wide rather than always exe-relative. Falls back to the plain
/// relative name (the engine's own default behavior) if the running
/// executable's path cannot be resolved at all.
fn shared_data_dir(name: &str) -> std::path::PathBuf {
    let identity = commits_upgrader::host_identity();
    commits_upgrader::shared_or_exe_relative(&identity, name)
        .unwrap_or_else(|| std::path::PathBuf::from(name))
}

/// Tells a launcher old enough to supervise that this process started.
///
/// Every launcher installed before this release waits up to 45 seconds for
/// a file at `COMMITS_HEALTH_MARKER` and, not finding one, kills the app,
/// **deletes the version folder it just launched**, and rolls back. This
/// build no longer writes that marker as part of its own startup, so
/// without this line the first launch of every update would destroy the
/// update -- including the one carrying the launcher that stops doing this.
///
/// Written immediately rather than after a grace period: the old launcher
/// polls, so an early marker simply ends its wait sooner. Nothing here
/// claims the app is healthy; it claims the process exists, which is all
/// the marker was ever able to prove.
///
/// Removable once no installed launcher predates the replaceable one -- and
/// [`refresh_launcher`] is what eventually makes that true. Until then this
/// is the bridge the whole migration crosses.
fn satisfy_legacy_launcher() {
    let Ok(path) = std::env::var("COMMITS_HEALTH_MARKER") else {
        return;
    };
    if let Err(error) = std::fs::write(&path, []) {
        eprintln!("could not write the legacy launcher's marker at {path}: {error}");
    }
}

/// Installs the launcher that shipped with this version as the entry point,
/// when it differs from the one already there.
///
/// The app is the only process that can do this: the launcher cannot
/// overwrite itself while it is the thing running. Every outcome is logged
/// rather than surfaced -- a refresh that fails leaves exactly the entry
/// point that was already there, which is a worse launcher rather than a
/// broken app, and refusing to open over it would be the larger failure.
fn refresh_launcher(logger: &bones_engine::logging::Logger) {
    match commits_upgrader::refresh_launcher_from_running_exe(&commits_upgrader::host_identity()) {
        Ok(true) => logger.log(
            bones_engine::logging::Level::Info,
            "updater",
            "installed this version's launcher as the entry point",
        ),
        Ok(false) => {}
        Err(error) => logger.log(
            bones_engine::logging::Level::Warn,
            "updater",
            &format!("could not refresh the entry point: {error}"),
        ),
    }
}

/// Turns a failed startup extension into something the user can act on.
///
/// The engine treats an extension that cannot attach as non-fatal: it logs the
/// error and keeps ticking. Nothing then opens the panel, so the window stays
/// blank with no hint that anything went wrong. The common cause is a busy or
/// cold machine pushing `instantiate` + `init` past the engine's one second
/// load budget, which relaunching usually clears -- worth saying out loud,
/// because a blank window looks like a broken build rather than a retryable
/// timeout.
///
/// Waits on its own thread: the report has to arrive while the engine is still
/// running its loop, not after it returns.
fn watch_startup_failure(failures: Receiver<String>) {
    // Longer than `extension_load_timeout` (30s, set in `run()` below) so a
    // genuine cold-load failure has time to arrive on `failures` rather than
    // being cut off by this wait ending first.
    const STARTUP_GRACE_PERIOD: std::time::Duration = std::time::Duration::from_secs(35);
    let spawned = std::thread::Builder::new()
        .name("commits-startup-report".to_string())
        .spawn(move || {
            let message = match failures.recv_timeout(STARTUP_GRACE_PERIOD) {
                // No failure arrived in time: the app started normally and
                // there is nothing to report.
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return,
                // The engine shut down without failing -- the ordinary path,
                // needing no dialog since the app is exiting anyway.
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                Ok(message) => message,
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
