use std::fs;
use std::io::Read;
use std::path::Path;

/// Extracts a downloaded ZIP payload into `update_dir`, replacing whatever
/// was staged there before. Staging is a separate step from applying so a
/// download can be verified and unpacked well before the moment it is
/// actually swapped into place.
pub fn stage(archive_bytes: &[u8], update_dir: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes))
        .map_err(|error| error.to_string())?;
    clear_dir(update_dir)?;
    fs::create_dir_all(update_dir).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(relative_path) = entry.enclosed_name() else {
            // A path that can't be safely joined under update_dir (absolute,
            // or escaping via "..") is refused rather than silently skipped,
            // since a payload doing that is either corrupt or hostile.
            return Err(format!("zip entry {} has an unsafe path", entry.name()));
        };
        let target = update_dir.join(relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut contents = Vec::new();
        entry.read_to_end(&mut contents).map_err(|error| error.to_string())?;
        fs::write(&target, contents).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Backs up `install_dir` into `backup_dir`, then copies the staged
/// `update_dir` over `install_dir`. The backup happens unconditionally
/// before any install-directory file is touched, so a failure partway
/// through the copy still leaves a complete backup to restore from.
///
/// `update_dir` and `backup_dir` must sit outside `install_dir`: if either
/// were nested inside it (e.g. `install/update/`), backing up `install_dir`
/// would try to copy the backup or update folder into itself.
///
/// `running_exe_names` are top-level filenames skipped in both directions
/// (e.g. the launcher's own executable): a real test of this caught
/// `restore_backup` permanently failing (no amount of retrying helps) when
/// it tried to copy the launcher's own backed-up exe over itself while it
/// was still running -- Windows can never allow that, backup and restore
/// need to leave that one file alone entirely.
pub fn apply(
    install_dir: &Path,
    update_dir: &Path,
    backup_dir: &Path,
    running_exe_names: &[&str],
) -> Result<(), String> {
    if !update_dir.is_dir() {
        return Err(String::from("no update is staged"));
    }
    if is_inside(update_dir, install_dir) || is_inside(backup_dir, install_dir) {
        return Err(String::from(
            "update_dir and backup_dir must not be nested inside install_dir",
        ));
    }
    clear_dir(backup_dir)?;
    fs::create_dir_all(backup_dir).map_err(|error| error.to_string())?;
    copy_dir_contents(install_dir, backup_dir, running_exe_names)?;
    copy_dir_contents(update_dir, install_dir, running_exe_names)?;
    clear_dir(update_dir)?;
    Ok(())
}

/// Reverses `apply`: copies `backup_dir`'s contents back over `install_dir`.
/// Used when the newly applied version fails its health check. See `apply`
/// for why `running_exe_names` must be passed the same way here too.
pub fn restore_backup(
    install_dir: &Path,
    backup_dir: &Path,
    running_exe_names: &[&str],
) -> Result<(), String> {
    if !backup_dir.is_dir() {
        return Err(String::from("no backup is available to restore"));
    }
    copy_dir_contents(backup_dir, install_dir, running_exe_names)
}

/// Whether `candidate` is `ancestor` itself or nested inside it. Falls back
/// to the given (uncanonicalized) path when either side does not exist yet,
/// since `canonicalize` requires the path to be real; a best-effort lexical
/// check is still far better than none for a path that has not been created.
fn is_inside(candidate: &Path, ancestor: &Path) -> bool {
    let candidate = candidate.canonicalize().unwrap_or_else(|_| candidate.to_path_buf());
    let ancestor = ancestor.canonicalize().unwrap_or_else(|_| ancestor.to_path_buf());
    candidate.starts_with(&ancestor)
}

/// Removes everything inside `path` without requiring it to already exist.
fn clear_dir(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Copies every file under `from` to the same relative location under `to`,
/// overwriting whatever is already there and creating `to` if needed. A
/// name in `skip` (matched case-insensitively against the entry's own file
/// name, at any depth) is left untouched in `to` rather than copied.
fn copy_dir_contents(from: &Path, to: &Path, skip: &[&str]) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    if !from.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if skip.iter().any(|skipped| name.eq_ignore_ascii_case(skipped)) {
            continue;
        }
        let target = to.join(&name);
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            copy_dir_contents(&entry.path(), &target, skip)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            for (name, contents) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(contents).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer
    }

    #[test]
    fn stages_a_zip_into_the_update_directory() {
        let dir = tempfile::tempdir().unwrap();
        let update_dir = dir.path().join("update");
        let archive = zip_bytes(&[("page.html", b"<html></html>"), ("nested/file.txt", b"hi")]);

        stage(&archive, &update_dir).unwrap();

        assert_eq!(fs::read(update_dir.join("page.html")).unwrap(), b"<html></html>");
        assert_eq!(fs::read(update_dir.join("nested/file.txt")).unwrap(), b"hi");
    }

    #[test]
    fn staging_replaces_whatever_was_staged_before() {
        let dir = tempfile::tempdir().unwrap();
        let update_dir = dir.path().join("update");
        stage(&zip_bytes(&[("old.txt", b"old")]), &update_dir).unwrap();
        stage(&zip_bytes(&[("new.txt", b"new")]), &update_dir).unwrap();

        assert!(!update_dir.join("old.txt").exists());
        assert_eq!(fs::read(update_dir.join("new.txt")).unwrap(), b"new");
    }

    #[test]
    fn apply_backs_up_the_current_install_before_overwriting_it() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("install");
        let update_dir = dir.path().join("update");
        let backup_dir = dir.path().join("backup");
        fs::create_dir_all(&install_dir).unwrap();
        fs::write(install_dir.join("app.exe"), b"old version").unwrap();
        stage(&zip_bytes(&[("app.exe", b"new version")]), &update_dir).unwrap();

        apply(&install_dir, &update_dir, &backup_dir, &[]).unwrap();

        assert_eq!(fs::read(install_dir.join("app.exe")).unwrap(), b"new version");
        assert_eq!(fs::read(backup_dir.join("app.exe")).unwrap(), b"old version");
        // The staged update is consumed once applied.
        assert!(!update_dir.join("app.exe").exists());
    }

    #[test]
    fn apply_refuses_an_update_or_backup_dir_nested_inside_install_dir() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("install");
        fs::create_dir_all(&install_dir).unwrap();
        // update_dir nested inside install_dir would make the backup step
        // try to copy itself into itself.
        let nested_update_dir = install_dir.join("update");
        stage(&zip_bytes(&[("app.exe", b"new")]), &nested_update_dir).unwrap();
        let backup_dir = dir.path().join("backup");

        let result = apply(&install_dir, &nested_update_dir, &backup_dir, &[]);

        assert!(result.is_err());
    }

    #[test]
    fn apply_fails_without_a_staged_update() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("install");
        let update_dir = dir.path().join("update");
        let backup_dir = dir.path().join("backup");
        fs::create_dir_all(&install_dir).unwrap();

        assert!(apply(&install_dir, &update_dir, &backup_dir, &[]).is_err());
    }

    #[test]
    fn restore_backup_reverses_apply_exactly() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("install");
        let update_dir = dir.path().join("update");
        let backup_dir = dir.path().join("backup");
        fs::create_dir_all(&install_dir).unwrap();
        fs::write(install_dir.join("app.exe"), b"good version").unwrap();
        stage(&zip_bytes(&[("app.exe", b"bad version")]), &update_dir).unwrap();
        apply(&install_dir, &update_dir, &backup_dir, &[]).unwrap();
        assert_eq!(fs::read(install_dir.join("app.exe")).unwrap(), b"bad version");

        restore_backup(&install_dir, &backup_dir, &[]).unwrap();

        assert_eq!(fs::read(install_dir.join("app.exe")).unwrap(), b"good version");
    }

    #[test]
    fn running_exe_names_are_left_untouched_by_apply_and_restore_backup() {
        // A real end-to-end test of this caught restore_backup permanently
        // failing (no retry duration helped) when it tried to overwrite the
        // launcher's own exe with its own backed-up copy while the launcher
        // process was still running it -- Windows can never allow that.
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("install");
        let update_dir = dir.path().join("update");
        let backup_dir = dir.path().join("backup");
        fs::create_dir_all(&install_dir).unwrap();
        fs::write(install_dir.join("app.exe"), b"old app").unwrap();
        fs::write(install_dir.join("launcher.exe"), b"the running launcher").unwrap();
        stage(&zip_bytes(&[("app.exe", b"new app")]), &update_dir).unwrap();

        apply(&install_dir, &update_dir, &backup_dir, &["launcher.exe"]).unwrap();
        assert_eq!(fs::read(install_dir.join("app.exe")).unwrap(), b"new app");
        assert_eq!(fs::read(install_dir.join("launcher.exe")).unwrap(), b"the running launcher");
        assert!(!backup_dir.join("launcher.exe").exists());

        fs::write(install_dir.join("app.exe"), b"corrupted by a bad update").unwrap();
        restore_backup(&install_dir, &backup_dir, &["launcher.exe"]).unwrap();
        assert_eq!(fs::read(install_dir.join("app.exe")).unwrap(), b"old app");
        assert_eq!(fs::read(install_dir.join("launcher.exe")).unwrap(), b"the running launcher");
    }
}
