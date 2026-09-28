//! Commits' own registration with the desktop: the names, icon, and entry
//! point `commits-desktop-integration` writes. The mechanism is that crate's;
//! everything here is what makes it this application.

use commits_desktop_integration::{Integration, Locations};

const ICON_PNG: &[u8] = include_bytes!("../assets/icon.png");

/// Registers the installed entry point, refusing when nothing is installed:
/// a registration pointing at a missing launcher would start nothing.
pub fn register() -> Result<(), String> {
    let (integration, locations) = resolve()?;
    if !integration.executable.is_file() {
        return Err(format!("Commits is not installed at {}", integration.executable.display()));
    }
    commits_desktop_integration::register(&integration, &locations)
}

/// Removes the registration; the installed files stay where they are.
pub fn unregister() -> Result<(), String> {
    let (integration, locations) = resolve()?;
    commits_desktop_integration::unregister(&integration, &locations)
}

/// Whether the installed entry point is fully registered.
pub fn is_registered() -> bool {
    resolve().is_ok_and(|(integration, locations)| commits_desktop_integration::is_registered(&integration, &locations))
}

/// Only the installed launcher is ever registered: it is the one path that
/// survives updates, so a registration keeps working across versions.
fn resolve() -> Result<(Integration<'static>, Locations), String> {
    let identity = bones_upgrader::host_identity();
    let install_dir = bones_upgrader::default_install_dir(&identity).ok_or_else(|| String::from("could not resolve the install directory"))?;
    let locations = Locations::for_current_user().ok_or_else(|| String::from("desktop registration is not available on this system"))?;
    let integration = Integration {
        id: "commits",
        name: "Commits",
        comment: "Git client",
        open_label: "Open in Commits",
        executable: install_dir.join(identity.launcher_exe()),
        icon_png: ICON_PNG,
    };
    Ok((integration, locations))
}
