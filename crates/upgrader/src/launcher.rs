//! The permanent entry point: the half of the mechanism that replaces the
//! app.
//!
//! The two processes replace each other, because neither can replace itself
//! while it is running. This one swaps the app by picking a different
//! version folder on its next start; the app swaps this one by writing over
//! the file it lives in. That mutual arrangement is why a launcher bug is
//! fixable at all, and why both halves belong in one crate.
//!
//! Everything here is deliberately thin. The launcher interprets nothing it
//! is given, spawns the current version's app and exits; it does not
//! supervise, retry, or read configuration. Logic that grows here is logic
//! that cannot be updated, since a running executable is the one file the
//! app cannot overwrite.

use std::path::Path;
use std::process::{Command, Stdio};

use crate::{current_version_dir, launcher_version, previous_version_dir, remove_version_dir, AppIdentity};

/// Handles `args` and returns.
///
/// Three flags are answered here rather than forwarded, and everything else
/// -- a repository path, anything a later app learns to take -- goes to the
/// app unread. The launcher is the only process that *can* answer them: it
/// is what the shell waits on, and the app it starts is detached with no
/// stdio to write back through.
///
/// A flag is recognised only as the first argument, which costs the app
/// nothing: no path it opens begins with a dash.
///
/// `Err` carries a message already fit to print: there is exactly one
/// caller, and everything that can go wrong here is a sentence about a path
/// rather than something a caller could recover from.
pub fn run(identity: &AppIdentity, install_dir: &Path, args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("--version") => {
            report(&version_text(identity, install_dir));
            Ok(())
        }
        Some("--help") => {
            report(&help_text(identity));
            Ok(())
        }
        Some("--rollback") => rollback(install_dir).map(|text| report(&text)),
        _ => launch(identity, install_dir, args),
    }
}

fn launch(identity: &AppIdentity, install_dir: &Path, args: &[String]) -> Result<(), String> {
    let Some(version_dir) = current_version_dir(install_dir) else {
        return Err(format!("no version is installed under {}", install_dir.display()));
    };
    let exe = version_dir.join(identity.app_exe());
    spawn_detached(&exe, args).map_err(|error| format!("could not launch {}: {error}", exe.display()))
}

/// Both versions, because the interesting answer is whether they agree.
///
/// A launcher left behind by an install is invisible otherwise -- it starts
/// a perfectly current app while itself being years old, which is exactly
/// the failure this whole mechanism exists to end. Printing the pair makes
/// it a glance rather than a file-timestamp investigation.
fn version_text(identity: &AppIdentity, install_dir: &Path) -> String {
    let installed = current_version_dir(install_dir)
        .and_then(|dir| dir.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_else(|| String::from("none installed"));
    format!("{} {installed}\nlauncher {}\n", identity.launcher_stem, launcher_version())
}

fn help_text(identity: &AppIdentity) -> String {
    let name = identity.launcher_stem;
    format!(
        "{name} - a desktop git client\n\
         \n\
         Usage:\n  \
           {name} [PATH]   open that repository, or a folder holding some\n  \
           {name}          open the chooser\n\
         \n\
         Options:\n  \
           --version       print the app and launcher versions\n  \
           --help          print this message\n  \
           --rollback      drop the newest installed version for the previous one\n"
    )
}

/// Drops the newest version folder so the previous one becomes current.
///
/// This is the escape hatch for a version that cannot start, and the whole
/// reason removing health supervision was safe: nothing guesses at a broken
/// build any more, so recovering from one is a thing the user asks for.
///
/// Refuses when there is nothing to fall back to. Deleting the only
/// installed version would leave the entry point with nothing to start,
/// which is worse than the broken version it replaced.
fn rollback(install_dir: &Path) -> Result<String, String> {
    let Some(current) = current_version_dir(install_dir) else {
        return Err(format!("no version is installed under {}", install_dir.display()));
    };
    let Some(previous) = previous_version_dir(install_dir) else {
        return Err(format!(
            "{} is the only installed version; there is nothing to roll back to",
            name_of(&current)
        ));
    };
    remove_version_dir(&current)?;
    Ok(format!("removed {}, now running {}\n", name_of(&current), name_of(&previous)))
}

fn name_of(dir: &Path) -> String {
    dir.file_name().unwrap_or_default().to_string_lossy().into_owned()
}

/// Writes to the console that invoked this process.
///
/// The launcher is a GUI-subsystem binary so that a double-click opens no
/// terminal, which also means it starts with no console of its own and
/// `println!` reaches nobody. `AttachConsole(ATTACH_PARENT_PROCESS)` borrows
/// the caller's, and `CONOUT$` is then the handle to write through --
/// attaching alone does not redeem the standard handles this process was
/// created with.
///
/// A redirect wins over the console. `commits --version > versions.txt` has
/// to land in the file, and writing to `CONOUT$` would bypass exactly the
/// redirection the caller asked for -- so a standard output handle this
/// process already owns is used as-is, and the console is the fallback for
/// when there is none.
///
/// Declared here rather than pulled from a Windows bindings crate: two
/// always-linked kernel32 functions are not worth a dependency in a crate
/// meant to be reused. Started from Explorer there is no parent console and
/// no redirect, the attach fails, and the text goes nowhere -- correct,
/// since nobody asked for it.
fn report(text: &str) {
    write_out(text, Stream::Out);
}

/// [`report`] for a failure. Public because the binary's own error path has
/// to reach the same terminal the successful one does: a plain `eprintln!`
/// from a GUI-subsystem process writes to a handle nobody is reading, so an
/// error message would simply not appear.
pub fn report_error(text: &str) {
    write_out(text, Stream::Err);
}

enum Stream {
    Out,
    Err,
}

fn write_out(text: &str, stream: Stream) {
    #[cfg(windows)]
    {
        const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
        const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
        const STD_ERROR_HANDLE: u32 = -12i32 as u32;
        extern "system" {
            fn AttachConsole(process_id: u32) -> i32;
            fn GetStdHandle(which: u32) -> isize;
        }
        let which = match stream {
            Stream::Out => STD_OUTPUT_HANDLE,
            Stream::Err => STD_ERROR_HANDLE,
        };
        let redirected = {
            let handle = unsafe { GetStdHandle(which) };
            handle != 0 && handle != -1
        };
        if !redirected && unsafe { AttachConsole(ATTACH_PARENT_PROCESS) } != 0 {
            if let Ok(mut console) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
                use std::io::Write;
                let _ = console.write_all(text.as_bytes());
                let _ = console.flush();
                return;
            }
        }
    }
    use std::io::Write;
    match stream {
        Stream::Out => {
            print!("{text}");
            let _ = std::io::stdout().flush();
        }
        Stream::Err => {
            eprint!("{text}");
            let _ = std::io::stderr().flush();
        }
    }
}

/// Spawns `exe` with its own fresh stdio rather than inheriting this
/// process's: a detached GUI child that outlives its parent would otherwise
/// keep the parent's stdout/stderr handles open for as long as it keeps
/// running, which is indefinite -- observed directly, where a caller
/// redirecting the launcher's stderr to a file hung waiting for that file's
/// handle count to reach zero long after the launcher itself had exited.
///
/// The child is left running rather than returned: dropping a `Child`
/// neither kills nor waits for it, and a Windows child outlives its parent
/// by default, so this process exiting immediately afterwards does not
/// affect the app it just started.
fn spawn_detached(exe: &Path, args: &[String]) -> std::io::Result<()> {
    let mut command = Command::new(exe);
    command.args(args);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command.spawn().map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> AppIdentity {
        AppIdentity {
            install_dir_name: ".probe",
            install_env_var: "PROBE_INSTALL_DIR",
            launcher_stem: "probe",
            app_stem: "probe-app",
        }
    }

    #[test]
    fn refuses_an_install_dir_with_no_version_folder() {
        let dir = tempfile::tempdir().unwrap();

        let error = run(&identity(), dir.path(), &[]).unwrap_err();

        assert!(error.contains("no version is installed"), "{error}");
    }

    fn install_with_versions(names: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for name in names {
            std::fs::create_dir_all(dir.path().join(name)).unwrap();
        }
        dir
    }

    #[test]
    fn version_reports_the_installed_app_and_the_launchers_own_build() {
        let dir = install_with_versions(&["1.2.0", "1.3.0"]);

        let text = version_text(&identity(), dir.path());

        assert!(text.contains("probe 1.3.0"), "{text}");
        assert!(text.contains("launcher "), "{text}");
    }

    #[test]
    fn version_says_so_when_nothing_is_installed_rather_than_inventing_one() {
        let dir = tempfile::tempdir().unwrap();

        let text = version_text(&identity(), dir.path());

        assert!(text.contains("none installed"), "{text}");
    }

    #[test]
    fn help_names_the_command_the_user_actually_types() {
        let text = help_text(&identity());

        assert!(text.contains("probe [PATH]"), "{text}");
        assert!(text.contains("--rollback"), "{text}");
    }

    #[test]
    fn rollback_drops_the_newest_version_so_the_previous_one_becomes_current() {
        let dir = install_with_versions(&["1.2.0", "1.3.0"]);

        let text = rollback(dir.path()).unwrap();

        assert!(!dir.path().join("1.3.0").exists());
        assert!(dir.path().join("1.2.0").exists());
        assert_eq!(current_version_dir(dir.path()).unwrap().file_name().unwrap(), "1.2.0");
        assert!(text.contains("removed 1.3.0"), "{text}");
    }

    #[test]
    fn rollback_refuses_to_leave_the_entry_point_with_nothing_to_start() {
        let dir = install_with_versions(&["1.3.0"]);

        let error = rollback(dir.path()).unwrap_err();

        assert!(error.contains("nothing to roll back to"), "{error}");
        assert!(dir.path().join("1.3.0").exists(), "the only version must survive");
    }

    #[test]
    fn rollback_reports_an_empty_install_rather_than_panicking() {
        let dir = tempfile::tempdir().unwrap();

        let error = rollback(dir.path()).unwrap_err();

        assert!(error.contains("no version is installed"), "{error}");
    }

    #[test]
    fn a_repository_path_is_never_mistaken_for_a_flag() {
        // The whole transparency rule in one test: only the three flags are
        // answered here, and an ordinary argument reaches the app instead.
        let dir = tempfile::tempdir().unwrap();
        let args = vec![String::from("C:/some/repo")];

        let error = run(&identity(), dir.path(), &args).unwrap_err();

        assert!(error.contains("no version is installed"), "{error}");
    }

    #[test]
    fn reports_the_app_it_could_not_start_by_path() {
        // A version folder with no app executable in it: the spawn fails,
        // and the message has to name what was missing rather than just
        // saying the OS refused.
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("1.0.0")).unwrap();

        let error = run(&identity(), dir.path(), &[]).unwrap_err();

        assert!(error.contains("could not launch"), "{error}");
        assert!(error.contains(&identity().app_exe()), "{error}");
    }
}
