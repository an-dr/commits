use std::path::PathBuf;

use crate::linux::{desktop_entry, escape_string, quote_exec_argument};
use crate::{Integration, Locations};

const ICON: &[u8] = b"\x89PNG not really";

fn integration(executable: &str) -> Integration<'static> {
    Integration {
        id: "sample",
        name: "Sample",
        comment: "A sample application",
        open_label: "Open in Sample",
        executable: PathBuf::from(executable),
        icon_png: ICON,
    }
}

fn scratch() -> (tempfile::TempDir, Locations) {
    let dir = tempfile::tempdir().unwrap();
    let locations = Locations { data_home: dir.path().to_path_buf(), refresh_caches: false };
    (dir, locations)
}

#[test]
fn desktop_entry_offers_the_application_for_folders() {
    let entry = desktop_entry(&integration("/home/user/.sample/app/sample"));
    assert!(entry.starts_with("[Desktop Entry]\n"));
    assert!(entry.contains("\nName=Sample\n"));
    assert!(entry.contains("\nExec=\"/home/user/.sample/app/sample\" %f\n"));
    assert!(entry.contains("\nIcon=sample\n"));
    assert!(entry.contains("\nMimeType=inode/directory;\n"));
}

#[test]
fn exec_argument_escapes_shell_and_field_code_characters() {
    assert_eq!(quote_exec_argument("/a b/c"), "\"/a b/c\"");
    assert_eq!(quote_exec_argument("/a\"$`\\b"), "\"/a\\\"\\$\\`\\\\b\"");
    assert_eq!(quote_exec_argument("/100%/app"), "\"/100%%/app\"");
}

#[test]
fn string_escapes_are_applied_over_exec_quoting() {
    // A backslash escaped by Exec quoting is escaped again as a string value.
    assert_eq!(escape_string(&quote_exec_argument("/a\\b")), "\"/a\\\\\\\\b\"");
    assert_eq!(escape_string("two\nlines"), "two\\nlines");
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    #[test]
    fn register_writes_the_entry_and_icon() {
        let (dir, locations) = scratch();
        let app = integration("/opt/sample/sample");
        assert!(!crate::is_registered(&app, &locations));

        crate::register(&app, &locations).unwrap();

        assert!(crate::is_registered(&app, &locations));
        assert_eq!(std::fs::read(dir.path().join("icons/hicolor/256x256/apps/sample.png")).unwrap(), ICON);
        let entry = std::fs::read_to_string(dir.path().join("applications/sample.desktop")).unwrap();
        assert_eq!(entry, desktop_entry(&app));
    }

    #[test]
    fn register_twice_leaves_one_registration() {
        let (dir, locations) = scratch();
        let app = integration("/opt/sample/sample");
        crate::register(&app, &locations).unwrap();
        crate::register(&app, &locations).unwrap();

        assert!(crate::is_registered(&app, &locations));
        assert_eq!(std::fs::read_dir(dir.path().join("applications")).unwrap().count(), 1);
    }

    #[test]
    fn unregister_removes_everything_and_is_idempotent() {
        let (dir, locations) = scratch();
        let app = integration("/opt/sample/sample");
        crate::register(&app, &locations).unwrap();

        crate::unregister(&app, &locations).unwrap();
        crate::unregister(&app, &locations).unwrap();

        assert!(!crate::is_registered(&app, &locations));
        assert!(!dir.path().join("applications/sample.desktop").exists());
        assert!(!dir.path().join("icons/hicolor/256x256/apps/sample.png").exists());
    }

    #[test]
    fn a_partial_or_stale_registration_is_not_registered_and_register_repairs_it() {
        let (dir, locations) = scratch();
        let app = integration("/opt/sample/sample");
        crate::register(&app, &locations).unwrap();

        std::fs::remove_file(dir.path().join("icons/hicolor/256x256/apps/sample.png")).unwrap();
        assert!(!crate::is_registered(&app, &locations));
        crate::register(&app, &locations).unwrap();
        assert!(crate::is_registered(&app, &locations));

        let moved = integration("/elsewhere/sample");
        assert!(!crate::is_registered(&moved, &locations));
    }

    #[test]
    fn unregister_leaves_the_executable_alone() {
        let (dir, locations) = scratch();
        let executable = dir.path().join("app/sample");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, b"binary").unwrap();
        let app = integration(executable.to_str().unwrap());

        crate::register(&app, &locations).unwrap();
        crate::unregister(&app, &locations).unwrap();

        assert_eq!(std::fs::read(&executable).unwrap(), b"binary");
    }
}
