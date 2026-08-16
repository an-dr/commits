//! This repository's launcher binary: the permanent entry point installed
//! at the install root as `commits.exe`, and the name users type.
//!
//! Everything it does lives in `commits_upgrader::launcher`, so a host that
//! wants its own binary name declares a `[[bin]]` like this one instead of
//! reimplementing the mechanism. See `docs/updating.md` for the layout it
//! walks.

// Same reasoning as the app: a release build is a desktop entry point, not
// a console tool, so Windows must not open a terminal behind it. Debug
// builds keep the console, which is where this file's eprintln! output goes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;

use commits_upgrader::launcher::report_error;

fn main() {
    let Some(install_dir) = std::env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf)) else {
        report_error("could not resolve the launcher's own directory\n");
        std::process::exit(1);
    };
    // Everything after this executable's own name belongs to the app, not
    // to the launcher: this process is the name users type, so
    // `commits C:/repo` has to reach the app unread. The launcher
    // deliberately interprets nothing, so a future app argument needs no
    // change here.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = commits_upgrader::launcher::run(&commits_upgrader::host_identity(), &install_dir, &args) {
        report_error(&format!("{error}\n"));
        std::process::exit(1);
    }
}
