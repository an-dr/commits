//! This application's launcher: the permanent entry point installed at the
//! install root as `commits.exe`, and the name users type.
//!
//! Everything it does lives in `bones_launcher`. Declaring the
//! binary here rather than taking the engine's reference `bones-launcher` is
//! the expected shape: the entry point carries the application's name, not
//! the engine's, because it is what users see in Explorer and the taskbar.
//! See `docs/updating.md` for the layout it walks.

// Same reasoning as the app: a release build is a desktop entry point, not
// a console tool, so Windows must not open a terminal behind it. Debug
// builds keep the console, which is where this file's eprintln! output goes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;

use bones_launcher::report_error;

fn main() {
    let Some(install_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    else {
        report_error("could not resolve the launcher's own directory\n");
        std::process::exit(1);
    };
    // Everything after this executable's own name belongs to the app, not
    // to the launcher: this process is the name users type, so
    // `commits C:/repo` has to reach the app unread. The launcher
    // deliberately interprets nothing, so a future app argument needs no
    // change here.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args
        .first()
        .is_some_and(|arg| arg == "--version" || arg == "--help")
    {
        let text = if args[0] == "--help" {
            "commits [<path>] [--show changes|conflicts|graph] [--branch <name>] [--commit <sha>] [--theme light|dark] [--theme-file <file>]\ncommits --version | --help | --previous [<path>]\n".to_string()
        } else {
            let folders = std::fs::read_dir(&install_dir)
                .into_iter()
                .flatten()
                .filter_map(|entry| {
                    let entry = entry.ok()?;
                    if !entry.file_type().ok()?.is_dir() {
                        return None;
                    }
                    Some((entry.path(), entry.metadata().ok()?.modified().ok()?))
                });
            let version = bones_versioning::order_version_folders(folders)
                .first()
                .and_then(|path| {
                    path.file_name()?
                        .to_str()
                        .and_then(bones_versioning::parse_folder_name)
                })
                .map(|version| version.to_string())
                .unwrap_or_else(|| "unknown".into());
            format!(
                "commits {version}\nlauncher {}\n",
                env!("UPGRADER_LAUNCHER_VERSION")
            )
        };
        print_response(&text);
        return;
    }
    if let Err(error) = bones_launcher::run(
        if cfg!(windows) {
            "commits-app.exe"
        } else {
            "commits-app"
        },
        &install_dir,
        &args,
    ) {
        report_error(&format!("{error}\n"));
        std::process::exit(1);
    }
}

/// A GUI-subsystem launcher borrows the caller's console, while retaining redirected stdout.
fn print_response(text: &str) {
    use std::io::Write;
    #[cfg(windows)]
    {
        extern "system" {
            fn GetStdHandle(which: u32) -> isize;
            fn AttachConsole(process: u32) -> i32;
        }
        let handle = unsafe { GetStdHandle(-11i32 as u32) };
        if (handle == 0 || handle == -1) && unsafe { AttachConsole(u32::MAX) } != 0 {
            if let Ok(mut console) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
                let _ = console.write_all(text.as_bytes());
                return;
            }
        }
    }
    let _ = std::io::stdout().write_all(text.as_bytes());
}
