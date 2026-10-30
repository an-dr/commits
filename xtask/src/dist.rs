//! Build each part independently and stage the install-shaped app tree.
use std::fs;
use std::path::Path;

use crate::{native, parse_options, process, App, Result};

pub fn run(args: &[String]) -> Result {
    let options = parse_options(args, &["--part", "--target"])?;
    let part = options.get("--part").copied().unwrap_or("all");
    if !["all", "web", "wasm", "host"].contains(&part) {
        return Err(format!("unknown build part: {part}").into());
    }
    let target = options.get("--target").copied();
    let windows = target.map_or(cfg!(windows), |triple| triple.contains("-windows-"));
    let app = App::read()?;
    let version_dir = app.root.join("dist/app").join(&app.version);
    fs::create_dir_all(version_dir.join("components"))?;
    for notice in ["LICENSE", "THIRD_PARTY_NOTICES.md"] {
        copy(&app.root.join(notice), &version_dir.join(notice))?;
    }
    if part == "all" || part == "web" {
        process::run(
            "Build page",
            &mut process::npm(&app.root, &["run", "build:web"]),
        )?;
        copy(
            &app.root.join("dist/ui/page.html"),
            &version_dir.join("page.html"),
        )?;
    }
    if part == "all" || part == "wasm" {
        // A pristine Windows ARM64 checkout compiles Wizer during this npm step.
        if cfg!(all(windows, target_arch = "aarch64"))
            && !app.root.join(".tools/wizer/bin/wizer.exe").is_file()
        {
            native::configure()?;
        }
        process::run(
            "Build components",
            &mut process::npm(&app.root, &["run", "build:wasm"]),
        )?;
        // The host loads every component in this folder, so one left by an
        // earlier build would still start alongside the fresh one.
        let components = version_dir.join("components");
        fs::remove_dir_all(&components)?;
        fs::create_dir_all(&components)?;
        copy(
            &app.root.join("dist/extensions/commits.wasm"),
            &components.join("commits.wasm"),
        )?;
    }
    if part == "all" || part == "host" {
        let cross_windows = windows && !cfg!(windows);
        if !cross_windows {
            native::configure()?;
        }
        for tool in ["cmake", "ninja"] {
            if process::find(tool).is_none() {
                return Err(
                    format!("{tool} is missing; run cargo xtask doctor for prerequisites").into(),
                );
            }
        }
        let mut command = process::cargo(&app.root);
        if cross_windows {
            command.arg("xwin");
        }
        command.args(["build", "--release", "-p", "commits-app"]);
        if let Some(target) = target {
            command.args(["--target", target]);
        }
        process::run("Build native app", &mut command)?;
        let bin_dir = target
            .map_or_else(
                || app.target_dir.clone(),
                |target| app.target_dir.join(target),
            )
            .join("release");
        stage_host(&bin_dir, &version_dir, windows)?;
    }
    println!(
        "Runnable app: {}",
        app.root
            .join(if windows {
                "dist/app/commits.exe"
            } else {
                "dist/app/commits"
            })
            .display()
    );
    Ok(())
}

/// Keep both launcher copies: entry point at the root and refresh payload inside.
fn stage_host(bin_dir: &Path, version_dir: &Path, windows: bool) -> Result {
    let executable = |name: &str| {
        if windows {
            format!("{name}.exe")
        } else {
            name.into()
        }
    };
    let launcher = executable("commits-launcher");
    copy(
        &bin_dir.join(&launcher),
        &version_dir.parent().unwrap().join(executable("commits")),
    )?;
    for name in [
        "commits-launcher",
        "commits-app",
        "commits-askpass",
        "commits-editor",
    ] {
        let name = executable(name);
        copy(&bin_dir.join(&name), &version_dir.join(&name))?;
    }
    Ok(())
}

pub fn copy(source: &Path, destination: &Path) -> Result {
    fs::copy(source, destination).map_err(|error| {
        format!(
            "copy {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_target_names_and_both_launcher_copies() {
        for windows in [true, false] {
            let temp = tempfile::tempdir().unwrap();
            let binaries = temp.path().join("binaries");
            let version = temp.path().join("app/1.2.3");
            fs::create_dir_all(&binaries).unwrap();
            fs::create_dir_all(&version).unwrap();
            for name in [
                "commits-launcher",
                "commits-app",
                "commits-askpass",
                "commits-editor",
            ] {
                let name = if windows {
                    format!("{name}.exe")
                } else {
                    name.into()
                };
                fs::write(binaries.join(name), b"binary").unwrap();
            }
            stage_host(&binaries, &version, windows).unwrap();
            let suffix = if windows { ".exe" } else { "" };
            assert_eq!(
                fs::read(version.parent().unwrap().join(format!("commits{suffix}"))).unwrap(),
                b"binary"
            );
            assert!(version.join(format!("commits-launcher{suffix}")).is_file());
            assert!(version.join(format!("commits-app{suffix}")).is_file());
        }
    }

    #[test]
    fn rejects_invalid_options_before_staging() {
        for args in [
            vec!["--part"],
            vec!["--part", "typo"],
            vec!["--target", "--part"],
            vec!["--unknown", "x"],
        ] {
            assert!(run(&args.into_iter().map(String::from).collect::<Vec<_>>()).is_err());
        }
    }
}
