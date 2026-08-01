# Shared packages

Host-independent product code shared with the `an-dr: Commits` VS Code
extension, which consumes this repository as a submodule and resolves these
exact paths.

A file belongs here when it must run unchanged under both the VS Code extension
host and the standalone app. Anything that knows about Bones, WebAssembly, the
native modules, or the desktop window belongs under `apps/` instead.

These packages are MIT-licensed, while the repository root is GPL-3.0. They are
imported snapshots: change them upstream and re-import, rather than editing them
to suit a host. Their directory names are part of the extension's integration
contract, so renaming or moving one breaks that repository.
