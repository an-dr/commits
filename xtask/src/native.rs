//! MSVC headers are needed even when clang is already on PATH.
#[cfg(windows)]
use std::{path::PathBuf, process::Command};

use crate::{process, App, Result};

#[cfg(not(windows))]
pub fn configure() -> Result {
    Ok(())
}

#[cfg(windows)]
pub fn configure() -> Result {
    use std::os::windows::process::CommandExt;
    if std::env::var_os("INCLUDE").is_some() {
        return Ok(());
    }
    let vswhere = std::env::var_os("ProgramFiles(x86)")
        .map(PathBuf::from)
        .ok_or("ProgramFiles(x86) is missing; use a Visual Studio Developer shell")?
        .join("Microsoft Visual Studio/Installer/vswhere.exe");
    // The C++ tools component must match the host architecture handed to vcvarsall.
    let (arch, component) = if cfg!(target_arch = "aarch64") {
        ("arm64", "Microsoft.VisualStudio.Component.VC.Tools.ARM64")
    } else {
        ("x64", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64")
    };
    let output = Command::new(vswhere)
        .args(["-latest", "-products", "*", "-requires", component, "-property", "installationPath"])
        .output().map_err(|error| format!("Visual Studio C++ tools not found: {error}; see CONTRIBUTING.md#native-windows-build"))?;
    let installation = String::from_utf8(output.stdout)?;
    let vcvars = PathBuf::from(installation.trim()).join("VC/Auxiliary/Build/vcvarsall.bat");
    if !output.status.success() || installation.trim().is_empty() || !vcvars.is_file() {
        return Err(
            "Install the Visual Studio C++ workload; see CONTRIBUTING.md#native-windows-build"
                .into(),
        );
    }
    let output = Command::new("cmd")
        .args(["/d", "/s", "/c"])
        .raw_arg(format!("\"\"{}\" {arch} >nul && set\"", vcvars.display()))
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "vcvarsall failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    for (name, value) in String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_once('='))
    {
        if !name.is_empty() {
            std::env::set_var(name, value);
        }
    }
    if std::env::var_os("INCLUDE").is_none() {
        return Err("MSVC setup supplied no INCLUDE; use a Visual Studio Developer shell".into());
    }
    Ok(())
}

pub fn doctor() -> Result {
    let mut missing = Vec::new();
    if let Err(error) = configure() {
        missing.push(error.to_string());
    }
    for (tool, hint) in [
        ("node", "install Node.js 22.12 or later with npm"),
        ("cmake", "install CMake"),
        ("ninja", "install Ninja"),
        ("rustc", "install Rust with rustup"),
    ] {
        match process::find(tool) {
            Some(path) => println!("{tool}: {}", path.display()),
            None => missing.push(format!("{tool} missing: {hint}")),
        }
    }
    // Optional: only agent debugging over the control channel needs it.
    match process::find("bones-cli") {
        Some(path) => println!("bones-cli: {}", path.display()),
        None => println!(
            "bones-cli (optional, for agent debugging): cargo install --locked --path vendor/bones/crates/bones-cli"
        ),
    }
    if cfg!(target_os = "linux") {
        println!(
            "Linux development libraries: see ci/Dockerfile and CONTRIBUTING.md#native-linux-build"
        );
    }
    let app = App::read()?;
    println!(
        "Commits {} at {}; Cargo output {}",
        app.version,
        app.root.display(),
        app.target_dir.display()
    );
    if missing.is_empty() {
        Ok(())
    } else {
        Err(missing.join("\n").into())
    }
}
