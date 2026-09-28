//! Registers an installed application with the desktop, and removes that
//! registration again.
//!
//! Registration is everything that makes the operating system aware of an
//! application: its entry in the application list and a way to open a folder
//! in it from the file manager. The application's own files are never
//! touched, so an unregistered application is simply portable.
//!
//! Nothing here knows which application it is registering -- every name,
//! path, and icon is an [`Integration`] field -- so the crate can move to
//! bones unchanged (see this crate's README).

use std::path::PathBuf;

mod linux;

/// The application being registered.
pub struct Integration<'a> {
    /// Stable machine name, used for file and key names.
    pub id: &'a str,
    /// Name shown in the application list.
    pub name: &'a str,
    /// One-line description shown beside the name.
    pub comment: &'a str,
    /// Label of the "open this folder" action.
    pub open_label: &'a str,
    /// Absolute path of the program to start; a folder is its only argument.
    pub executable: PathBuf,
    /// PNG bytes of the application icon.
    pub icon_png: &'a [u8],
}

/// Where a registration is written.
///
/// Callers normally take [`Locations::for_current_user`]; tests point every
/// field at a scratch directory so nothing reaches the real desktop.
pub struct Locations {
    /// The freedesktop.org data directory (`$XDG_DATA_HOME`) on Linux.
    pub data_home: PathBuf,
    /// Whether to refresh the desktop's caches after a change. Off in tests,
    /// where the caches being refreshed would be the real ones.
    pub refresh_caches: bool,
}

impl Locations {
    /// The current user's own locations, or `None` when the home directory
    /// cannot be resolved.
    pub fn for_current_user() -> Option<Self> {
        Some(Self { data_home: dirs::data_dir()?, refresh_caches: true })
    }
}

/// Writes every part of the registration. Registering again replaces a stale
/// or partial registration rather than adding a second one.
pub fn register(integration: &Integration, locations: &Locations) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return linux::register(integration, locations);
    #[cfg(not(target_os = "linux"))]
    return Err(unsupported(integration, locations));
}

/// Removes every part of the registration. Removing something that is not
/// registered succeeds, and the application's own files are left in place.
pub fn unregister(integration: &Integration, locations: &Locations) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return linux::unregister(integration, locations);
    #[cfg(not(target_os = "linux"))]
    return Err(unsupported(integration, locations));
}

/// Whether every part of the registration is present and current. A partial
/// or stale registration reports `false`, so registering again repairs it.
pub fn is_registered(integration: &Integration, locations: &Locations) -> bool {
    #[cfg(target_os = "linux")]
    return linux::is_registered(integration, locations);
    #[cfg(not(target_os = "linux"))]
    return { let _ = (integration, locations); false };
}

#[cfg(not(target_os = "linux"))]
fn unsupported(_integration: &Integration, _locations: &Locations) -> String {
    String::from("desktop registration is not supported on this operating system")
}

#[cfg(test)]
mod tests;
