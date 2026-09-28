//! The shell verbs a Windows registration writes, as plain strings.
//!
//! Kept apart from the registry calls so what gets written can be tested on
//! any operating system, not only the one that can write it.

#![cfg_attr(not(windows), allow(dead_code))]

use crate::Integration;

/// One classic shell verb: a key under the classes key, its values, and the
/// command its `command` subkey runs.
pub(crate) struct Verb {
    /// Path relative to the classes key.
    pub key: String,
    /// The label shown in the context menu (the key's default value).
    pub label: String,
    /// The `Icon` value.
    pub icon: String,
    /// The `command` subkey's default value.
    pub command: String,
}

/// The folder verb (`%1` is the clicked folder) and the folder background
/// verb (`%V` is the folder whose empty space was clicked).
pub(crate) fn verbs(integration: &Integration) -> [Verb; 2] {
    let executable = integration.executable.to_string_lossy();
    let verb = |parent: &str, placeholder: &str| Verb {
        key: format!(r"{parent}\shell\{}", integration.id),
        label: integration.open_label.to_string(),
        icon: executable.to_string(),
        command: format!("\"{executable}\" \"{placeholder}\""),
    };
    [verb("Directory", "%1"), verb(r"Directory\Background", "%V")]
}

/// The shortcut file name, shared by the Start Menu and the desktop.
pub(crate) fn shortcut_name(integration: &Integration) -> String {
    format!("{}.lnk", integration.name)
}
