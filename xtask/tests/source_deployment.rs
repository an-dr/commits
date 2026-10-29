//! Exercise the retained Windows helper without touching the real installation.
//! The binary name avoids Windows installer detection and its elevation prompt.
#![cfg(windows)]

use std::{fs, path::Path, process::Command};

fn install(source: &Path, destination: &Path) {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/install.ps1");
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .arg("-Source")
        .arg(source)
        .arg("-InstallDir")
        .arg(destination)
        .arg("-SkipBuild")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn repeated_installs_create_distinct_bones_instances_without_overwriting() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let destination = temp.path().join("installed");
    fs::create_dir_all(source.join("1.2.3/state")).unwrap();
    fs::write(source.join("commits.exe"), b"launcher").unwrap();
    fs::write(source.join("1.2.3/commits-app.exe"), b"first build").unwrap();
    fs::write(source.join("1.2.3/state/save"), b"runtime data").unwrap();
    install(&source, &destination);
    assert!(!destination.join("1.2.3/state").exists());
    install(&source, &destination);
    let instance = fs::read_dir(&destination)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("1.2.3~")
        })
        .expect("second installation must use the Bones instance delimiter");
    fs::write(instance.join("keep.log"), b"previous installation").unwrap();
    install(&source, &destination);
    assert_eq!(
        fs::read(instance.join("keep.log")).unwrap(),
        b"previous installation"
    );
    assert_eq!(
        fs::read_dir(&destination)
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().path().is_dir())
            .count(),
        2
    );
}
