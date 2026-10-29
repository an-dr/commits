//! Child processes inherit output and fail at the step that failed.
use std::path::Path;
use std::process::Command;

use crate::Result;

pub fn cargo(root: &Path) -> Command {
    let mut command = Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command.current_dir(root);
    command
}

pub fn npm(root: &Path, args: &[&str]) -> Command {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.args(["/d", "/c", "npm.cmd"]);
        command
    } else {
        Command::new("npm")
    };
    command.current_dir(root).args(args);
    command
}

pub fn run(description: &str, command: &mut Command) -> Result {
    println!("==> {description}");
    let status = command.status().map_err(|error| {
        format!(
            "{description}: could not start {:?}: {error}",
            command.get_program()
        )
    })?;
    if !status.success() {
        return Err(format!("{description} failed ({status})").into());
    }
    Ok(())
}

/// Resolve executables directly; npm.cmd is only used through cmd on Windows.
pub fn find(program: &str) -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| {
            directory.join(if cfg!(windows) {
                format!("{program}.exe")
            } else {
                program.into()
            })
        })
        .find(|candidate| candidate.is_file())
}
