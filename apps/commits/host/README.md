# Native host

The desktop process. It embeds Bones as a library, enables the web module,
registers the native capability modules, and serves the page file to the guest.
Extension, save, and page paths resolve beside the executable. User settings
are the exception: the trusted settings module owns
`~/.commits/settings.json` and replaces it atomically for the `commits`
component.

Code belongs here when it needs the operating system or owns process lifetime.
Capabilities general enough for another host belong in `crates/`; anything the
WebAssembly guest must run belongs in `bones-adapter`.
