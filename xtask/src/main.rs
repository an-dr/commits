//! Commits build tasks, using the same Rust toolchain as the native app.
mod ci;
mod dist;
mod native;
mod package;
mod process;
mod wire_types;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("dist") => dist::run(&args[1..]),
        Some("ci") => ci::run(&args[1..]),
        Some("package-release") => package::run(&args[1..]),
        Some("test") => test(&args[1..]),
        Some("wire-types") => wire_types::run(&args[1..]),
        Some("doctor") if args.len() == 1 => {
            process::run(
                "Rust toolchain",
                process::cargo(&std::env::current_dir()?).arg("--version"),
            )?;
            native::doctor()
        }
        _ => Err(
            "usage: cargo xtask doctor | test [cargo test args, default --workspace] | dist [--part web|wasm|host|all] [--target <triple>] | package-release --platform <platform> [--tag <tag>] [--repository <owner/name>] | ci --platform <platform> [--tag <tag>] | wire-types"
                .into(),
        ),
    }
}

/// Workspace tests, with the MSVC environment native crates need on Windows.
/// Arguments replace the default `--workspace`, so `-p <crate>` narrows the run.
fn test(args: &[String]) -> Result {
    native::configure()?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut command = process::cargo(root);
    command.arg("test");
    if args.is_empty() {
        command.arg("--workspace");
    } else {
        command.args(args);
    }
    process::run("Rust tests", &mut command)
}

/// Reject misspelled, duplicated or valueless options before doing any work.
fn parse_options<'a>(
    args: &'a [String],
    allowed: &[&str],
) -> Result<std::collections::BTreeMap<&'a str, &'a str>> {
    let mut options = std::collections::BTreeMap::new();
    let mut pairs = args.chunks_exact(2);
    for pair in &mut pairs {
        if !allowed.contains(&pair[0].as_str()) || pair[1].starts_with("--") || pair[1].is_empty() {
            return Err(format!("invalid option/value: {} {}", pair[0], pair[1]).into());
        }
        if options.insert(pair[0].as_str(), pair[1].as_str()).is_some() {
            return Err(format!("duplicate option: {}", pair[0]).into());
        }
    }
    if !pairs.remainder().is_empty() {
        return Err("option needs a value".into());
    }
    Ok(options)
}

/// Manifest and output facts from Cargo, including target-dir overrides.
struct App {
    root: PathBuf,
    target_dir: PathBuf,
    version: String,
}

impl App {
    fn read() -> Result<Self> {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let output = process::cargo(&root)
            .args(["metadata", "--no-deps", "--format-version", "1"])
            .output()?;
        if !output.status.success() {
            return Err(format!(
                "cargo metadata: {}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }
        let metadata: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        let version = metadata["packages"]
            .as_array()
            .and_then(|packages| {
                packages
                    .iter()
                    .find(|package| package["name"] == "commits-app")
            })
            .and_then(|package| package["version"].as_str())
            .ok_or("cargo metadata has no commits-app version")?
            .to_owned();
        let target_dir = metadata["target_directory"]
            .as_str()
            .ok_or("cargo metadata has no target_directory")?
            .into();
        Ok(Self {
            root,
            target_dir,
            version,
        })
    }
}
