fn main() {
    // Embeds assets/icon.ico as the .exe resource icon -- Explorer, the
    // taskbar, and pinned/Start Menu shortcuts all read it from there.
    // Cargo links one build script's resource output into every binary in
    // this package, so all four commits-* executables pick it up alike.
    // No-op off Windows: there is no .exe resource section to embed into.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        winresource::WindowsResource::new()
            .set_icon("assets/icon.ico")
            .compile()
            .expect("failed to embed the Windows exe icon");
    }
}
