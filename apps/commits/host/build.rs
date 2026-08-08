fn main() {
    // Something in commits-app's link graph (the vendored wasmtime-based
    // engine -- vendor/bones is read-only upstream, see ADR-003) pulls in a
    // reference to the debug CRT even in release builds, producing a benign
    // but noisy `LNK4098: defaultlib 'MSVCRTD' conflicts with use of other
    // libs` warning. Excluding it as a default library is exactly the fix
    // the linker itself suggests, and is safe here: nothing this binary
    // links is meant to use the debug CRT. Scoped to this one bin and to
    // MSVC, since the flag is meaningless on any other linker.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bin=commits-app=/NODEFAULTLIB:MSVCRTD");
    }

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
