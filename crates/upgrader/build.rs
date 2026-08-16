//! Embeds a Windows resource icon into the launcher, when the host names
//! one.
//!
//! The launcher is the executable users actually see -- Explorer, the
//! taskbar, and pinned Start Menu shortcuts all point at it -- so it needs
//! the icon far more than the app behind it does. It used to inherit one by
//! sharing a package with the app; built here, it has to ask.
//!
//! `UPGRADER_LAUNCHER_ICON` names the `.ico`, absolute or relative to this
//! crate. A host sets it in its own `.cargo/config.toml`, where `relative =
//! true` resolves it against the workspace root. Unset, this does nothing:
//! a consumer that has not chosen an icon still builds, and gets the
//! platform default rather than a build failure.
fn main() {
    println!("cargo:rerun-if-env-changed=UPGRADER_LAUNCHER_ICON");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let Ok(icon) = std::env::var("UPGRADER_LAUNCHER_ICON") else {
        return;
    };
    if icon.trim().is_empty() {
        return;
    }
    println!("cargo:rerun-if-changed={icon}");
    winresource::WindowsResource::new()
        .set_icon(&icon)
        .compile()
        .expect("failed to embed the launcher's Windows exe icon");
}
