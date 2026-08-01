# commits

The standalone desktop Git client: the shared product core running on the Bones
engine rather than inside VS Code.

The parts divide by what they talk to. `host` is the native process and speaks
to the operating system. `bones-adapter` is the WebAssembly guest and speaks to
the Bones ABI. `web` is the page and speaks to the DOM. `scripts` builds those
parts.

The File menu opens the repository selector, which lists recently opened
repositories.

Everything here is GPL-3.0 and may depend on Bones. Product logic that should
also work in the VS Code extension does not belong here; it belongs in
`packages/`.
