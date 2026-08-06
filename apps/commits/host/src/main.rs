// Release builds are a desktop app, so Windows must not open a console behind
// the window. Debug builds keep the console, which is where their logs go.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod diagnostics;
mod page;
mod settings;
mod splash;

use std::sync::mpsc::Receiver;

fn main() {
    if let Err(error) = run() {
        eprintln!("fatal: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let (logger, failures) = diagnostics::install();
    report_a_failed_startup_extension(failures);
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
        .run()?;
    Ok(())
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
fn report_a_failed_startup_extension(failures: Receiver<String>) {
    let spawned = std::thread::Builder::new()
        .name("commits-startup-report".to_string())
        .spawn(move || {
            // Errs only when the engine shuts down without failing, which is
            // the ordinary path and needs no report.
            let Ok(message) = failures.recv() else {
                return;
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
