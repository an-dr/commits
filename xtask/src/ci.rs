//! One container job, shared by local Docker builds and GitHub Actions.
use std::fs;

use crate::{dist, package, parse_options, process, App, Result};

pub fn run(args: &[String]) -> Result {
    let options = parse_options(args, &["--platform", "--tag"])?;
    let platform = options
        .get("--platform")
        .copied()
        .ok_or("--platform is required")?;
    let target = select_target(platform)?;
    let app = App::read()?;
    let tag = options.get("--tag").copied();
    if tag.is_some_and(|tag| tag != format!("v{}", app.version)) {
        return Err(format!("release tag must match app version: v{}", app.version).into());
    }
    // All platforms share the staging directory. Never package stale binaries.
    let version_dir = app.root.join("dist/app").join(&app.version);
    if version_dir.exists() {
        let resolved = version_dir.canonicalize()?;
        if !resolved.starts_with(app.root.canonicalize()?)
            || fs::symlink_metadata(&version_dir)?.file_type().is_symlink()
        {
            return Err(
                "refusing to remove a staging directory outside the repository or a symlink".into(),
            );
        }
        fs::remove_dir_all(&version_dir)?;
    }
    // Optional native npm dependencies can differ between build platforms.
    process::run(
        "Install npm packages",
        &mut process::npm(&app.root, &["install", "--no-audit", "--no-fund"]),
    )?;
    dist::run(&["--part", "web"].map(String::from))?;
    dist::run(&["--part", "wasm"].map(String::from))?;
    let mut host_args = vec!["--part".into(), "host".into()];
    if let Some(target) = target {
        host_args.extend(["--target".into(), target.into()]);
    }
    dist::run(&host_args)?;
    if platform == "linux-x64" {
        for script in ["check", "test"] {
            process::run(script, &mut process::npm(&app.root, &["run", script]))?;
        }
        crate::test(&[])?;
    }
    let mut package_args = vec!["--platform".into(), platform.into()];
    if let Some(tag) = tag {
        package_args.extend(["--tag".into(), tag.into()]);
    }
    package::run(&package_args)
}

fn select_target(platform: &str) -> Result<Option<&'static str>> {
    match platform {
        "linux-x64" => Ok(Some("x86_64-unknown-linux-gnu")),
        "windows-x64" => Ok(Some("x86_64-pc-windows-msvc")),
        "windows-arm64" => Ok(Some("aarch64-pc-windows-msvc")),
        _ => Err(format!("unsupported CI platform: {platform}").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_platforms_and_rejects_unknown_platforms() {
        assert_eq!(
            select_target("linux-x64").unwrap(),
            Some("x86_64-unknown-linux-gnu")
        );
        assert_eq!(
            select_target("windows-x64").unwrap(),
            Some("x86_64-pc-windows-msvc")
        );
        assert_eq!(
            select_target("windows-arm64").unwrap(),
            Some("aarch64-pc-windows-msvc")
        );
        assert!(select_target("typo").is_err());
    }
}
