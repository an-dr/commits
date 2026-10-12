//! Commits' own registration with the desktop: the names, icon, and entry
//! point Bones’ desktop module writes. The mechanism is upstream;
//! everything here is what makes it this application.

use bones_kernel::desktop::{Integration, Locations};

const ICON_PNG: &[u8] = include_bytes!("../assets/icon.png");

/// Whether the installed entry point is fully registered.
pub fn is_registered() -> bool {
    resolve().is_ok_and(|(integration, locations)| {
        bones_kernel::desktop::is_registered(&integration, &locations)
    })
}

/// Only the installed launcher is ever registered: it is the one path that
/// survives updates, so a registration keeps working across versions.
fn resolve() -> Result<(Integration<'static>, Locations), String> {
    let identity = crate::installation::identity();
    let install_dir = bones_kernel::upgrade::UpgradeModule::new(crate::installation::config())
        .install_dir()
        .ok_or_else(|| String::from("could not resolve the install directory"))?;
    let locations = Locations::for_current_user()
        .ok_or_else(|| String::from("desktop registration is not available on this system"))?;
    let integration = Integration {
        id: "commits",
        name: "Commits",
        comment: "Git client",
        open_label: "Open in Commits",
        executable: install_dir.join(identity.launcher_exe()),
        icon_png: ICON_PNG,
        categories: "Development;RevisionControl;",
    };
    Ok((integration, locations))
}

/// Registration configuration fixed by the native composition.
pub fn integration() -> Result<Integration<'static>, String> {
    resolve().map(|(integration, _)| integration)
}
