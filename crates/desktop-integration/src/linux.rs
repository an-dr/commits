//! freedesktop.org registration: a desktop entry and a themed icon under
//! `$XDG_DATA_HOME`, per user.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::{Integration, Locations};

fn desktop_entry_path(integration: &Integration, locations: &Locations) -> PathBuf {
    applications_dir(locations).join(format!("{}.desktop", integration.id))
}

fn icon_path(integration: &Integration, locations: &Locations) -> PathBuf {
    icon_theme_dir(locations).join("256x256/apps").join(format!("{}.png", integration.id))
}

fn applications_dir(locations: &Locations) -> PathBuf {
    locations.data_home.join("applications")
}

fn icon_theme_dir(locations: &Locations) -> PathBuf {
    locations.data_home.join("icons/hicolor")
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn register(integration: &Integration, locations: &Locations) -> Result<(), String> {
    write_file(&icon_path(integration, locations), integration.icon_png)?;
    write_file(&desktop_entry_path(integration, locations), desktop_entry(integration).as_bytes())?;
    refresh_caches(locations);
    Ok(())
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn unregister(integration: &Integration, locations: &Locations) -> Result<(), String> {
    remove_file(&desktop_entry_path(integration, locations))?;
    remove_file(&icon_path(integration, locations))?;
    refresh_caches(locations);
    Ok(())
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn is_registered(integration: &Integration, locations: &Locations) -> bool {
    let entry = std::fs::read_to_string(desktop_entry_path(integration, locations));
    let icon = std::fs::read(icon_path(integration, locations));
    matches!((entry, icon), (Ok(entry), Ok(icon)) if entry == desktop_entry(integration) && icon == integration.icon_png)
}

/// The desktop entry for `integration`.
///
/// `MimeType=inode/directory;` is what offers the application in a file
/// manager's "Open With" list for folders; `%f` receives that folder, and
/// is empty when the application is started from the application list.
pub(crate) fn desktop_entry(integration: &Integration) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.5\n\
         Name={name}\n\
         Comment={comment}\n\
         Exec={exec} %f\n\
         Icon={id}\n\
         Terminal=false\n\
         Categories=Development;RevisionControl;\n\
         MimeType=inode/directory;\n",
        name = escape_string(integration.name),
        comment = escape_string(integration.comment),
        exec = escape_string(&quote_exec_argument(&integration.executable.to_string_lossy())),
        id = integration.id,
    )
}

/// Quotes one `Exec` argument: inside double quotes, `"`, `` ` ``, `$` and
/// `\` are backslash-escaped, and `%` is doubled so it is not read as a
/// field code.
pub(crate) fn quote_exec_argument(argument: &str) -> String {
    let mut quoted = String::from("\"");
    for character in argument.chars() {
        match character {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(character);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    quoted
}

/// Applies the general string-value escapes, which a reader undoes before it
/// parses `Exec` quoting -- so a backslash from quoting is written twice.
pub(crate) fn escape_string(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\t' => escaped.push_str("\\t"),
            '\r' => escaped.push_str("\\r"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn write_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    std::fs::write(path, contents).map_err(|error| format!("could not write {}: {error}", path.display()))
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(format!("could not remove {}: {error}", path.display())),
        _ => Ok(()),
    }
}

/// Lets file managers see the change without a new login. Best effort: a
/// desktop without these tools reads the files directly.
///
/// The icon cache is only refreshed where one already exists: creating one
/// would leave icons installed later by other applications hidden behind it.
fn refresh_caches(locations: &Locations) {
    if !locations.refresh_caches {
        return;
    }
    run_quietly(Command::new("update-desktop-database").arg(applications_dir(locations)));
    let theme = icon_theme_dir(locations);
    if theme.join("icon-theme.cache").is_file() {
        run_quietly(Command::new("gtk-update-icon-cache").args(["--quiet", "--ignore-theme-index"]).arg(theme));
    }
}

fn run_quietly(command: &mut Command) {
    let _ = command.stdout(Stdio::null()).stderr(Stdio::null()).status();
}
