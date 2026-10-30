//! Updater ZIP and manifest contract. The archive root is the version payload.
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;

use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{parse_options, App, Result};

pub fn run(args: &[String]) -> Result {
    let options = parse_options(args, &["--platform", "--tag", "--repository"])?;
    let platform = options.get("--platform").ok_or("--platform is required")?;
    validate_platform(platform)?;
    let app = App::read()?;
    let tag = format!("v{}", app.version);
    if options.get("--tag").is_some_and(|given| *given != tag) {
        return Err(format!("release tag must match app version: {tag}").into());
    }
    let repository = options
        .get("--repository")
        .copied()
        .unwrap_or("an-dr/commits");
    if repository.split('/').count() != 2
        || repository.split('/').any(|part| {
            part.is_empty()
                || !part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return Err("repository must be owner/name".into());
    }
    let source = app.root.join("dist/app").join(&app.version);
    validate_payload(&source, platform)?;
    let output = app.root.join("release");
    fs::create_dir_all(&output)?;
    let zip_name = format!("commits-{}-{platform}.zip", app.version);
    let zip_path = output.join(&zip_name);
    write_zip(&source, &zip_path, platform)?;
    let mut hash = Sha256::new();
    io::copy(&mut File::open(&zip_path)?, &mut hash)?;
    let manifest = serde_json::json!({
        "version": app.version,
        "url": format!("https://github.com/{repository}/releases/download/{tag}/{zip_name}"),
        "sha256": format!("{:x}", hash.finalize()),
    });
    let manifest_path = output.join(format!("commits-{platform}.json"));
    fs::write(
        &manifest_path,
        format!("{}\n", serde_json::to_string_pretty(&manifest)?),
    )?;
    println!(
        "Packaged {}\nManifest {}",
        zip_path.display(),
        manifest_path.display()
    );
    Ok(())
}

fn validate_platform(platform: &str) -> Result {
    if !["windows-x64", "windows-arm64", "linux-x64"].contains(&platform) {
        return Err(format!("unsupported platform: {platform}").into());
    }
    Ok(())
}

fn validate_payload(source: &Path, platform: &str) -> Result {
    let suffix = if platform.starts_with("windows-") {
        ".exe"
    } else {
        ""
    };
    for file in [
        "page.html",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "components/commits.wasm",
    ] {
        if !source.join(file).is_file() {
            return Err(format!("missing {file}; run cargo xtask dist first").into());
        }
    }
    for name in [
        "commits-app",
        "commits-launcher",
        "commits-askpass",
        "commits-editor",
    ] {
        validate_binary(&source.join(format!("{name}{suffix}")), platform)?;
        let opposite = if suffix.is_empty() {
            format!("{name}.exe")
        } else {
            name.into()
        };
        if source.join(opposite).exists() {
            return Err(
                "mixed-platform payload; rebuild in a clean dist/app version folder".into(),
            );
        }
    }
    Ok(())
}

/// Inspect target architecture rather than trusting filenames or the build host.
fn validate_binary(path: &Path, platform: &str) -> Result {
    use std::io::{Seek, SeekFrom};
    let mut file = File::open(path).map_err(|error| {
        format!(
            "{}: {error}; run cargo xtask dist --part host",
            path.display()
        )
    })?;
    let mut header = [0; 64];
    file.read_exact(&mut header)?;
    let valid = if platform.starts_with("windows-") && &header[..2] == b"MZ" {
        let offset = u32::from_le_bytes(header[60..64].try_into().unwrap());
        file.seek(SeekFrom::Start(offset.into()))?;
        let mut pe = [0; 6];
        file.read_exact(&mut pe)?;
        let machine = u16::from_le_bytes([pe[4], pe[5]]);
        &pe[..4] == b"PE\0\0"
            && machine
                == if platform == "windows-arm64" {
                    0xaa64
                } else {
                    0x8664
                }
    } else {
        platform == "linux-x64"
            && &header[..6] == b"\x7fELF\x02\x01"
            && u16::from_le_bytes([header[18], header[19]]) == 62
    };
    if !valid {
        return Err(format!("{} is not a {platform} binary", path.display()).into());
    }
    Ok(())
}

fn runtime_artifact(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "state" || name.ends_with(".webview2") || name.ends_with(".log")
}

fn write_zip(source: &Path, output: &Path, platform: &str) -> Result {
    let mut writer = ZipWriter::new(File::create(output)?);
    add_directory(&mut writer, source, source, platform)?;
    writer.finish()?;
    Ok(())
}

fn add_directory(
    writer: &mut ZipWriter<File>,
    root: &Path,
    directory: &Path,
    platform: &str,
) -> Result {
    let mut entries = fs::read_dir(directory)?.collect::<io::Result<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if runtime_artifact(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(format!("refusing payload symlink {}", entry.path().display()).into());
        }
        if kind.is_dir() {
            add_directory(writer, root, &entry.path(), platform)?;
        } else if kind.is_file() {
            let path = entry.path();
            let name = path
                .strip_prefix(root)?
                .to_str()
                .ok_or("non-UTF8 archive path")?
                .replace('\\', "/");
            let executable = platform == "linux-x64"
                && [
                    "commits-app",
                    "commits-launcher",
                    "commits-askpass",
                    "commits-editor",
                ]
                .contains(&name.as_str());
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(if executable { 0o755 } else { 0o644 });
            writer.start_file(name, options)?;
            io::copy(&mut File::open(path)?, writer)?;
        } else {
            return Err("payload contains a special file".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_has_payload_at_root_and_omits_runtime_data() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("1.2.3");
        fs::create_dir_all(source.join("components")).unwrap();
        fs::create_dir_all(source.join("profile.WebView2")).unwrap();
        fs::create_dir_all(source.join("state")).unwrap();
        for name in [
            "commits-app",
            "page.html",
            "components/commits.wasm",
            "debug.LOG",
            "state/save",
            "profile.WebView2/file",
        ] {
            fs::write(source.join(name), b"payload").unwrap();
        }
        let output = temp.path().join("app.zip");
        write_zip(&source, &output, "linux-x64").unwrap();
        let mut archive = zip::ZipArchive::new(File::open(output).unwrap()).unwrap();
        assert_eq!(archive.len(), 3);
        assert!(archive.by_name("components/commits.wasm").is_ok());
        assert_eq!(
            archive.by_name("commits-app").unwrap().unix_mode().unwrap() & 0o777,
            0o755
        );
        assert_eq!(archive.by_name("page.html").unwrap().size(), 7);
    }

    #[test]
    fn rejects_mismatched_binary_architecture() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("app.exe");
        let mut bytes = vec![0; 70];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[60..64].copy_from_slice(&64u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");
        bytes[68..70].copy_from_slice(&0xaa64u16.to_le_bytes());
        fs::write(&path, bytes).unwrap();
        assert!(validate_binary(&path, "windows-arm64").is_ok());
        assert!(validate_binary(&path, "windows-x64").is_err());
        assert!(validate_binary(&path, "linux-x64").is_err());
    }

    #[test]
    fn refuses_invalid_platform_tag_and_missing_payload() {
        assert!(validate_platform("macos").is_err());
        assert!(
            run(&["--platform", "windows-arm64", "--tag", "v0.0.0"].map(String::from)).is_err()
        );
        let temp = tempfile::tempdir().unwrap();
        assert!(validate_payload(temp.path(), "windows-arm64").is_err());
    }
}
