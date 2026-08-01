# Standalone page

The browser side of the application: what boots the shared webview inside a
Bones panel, supplies the standalone theme, and bridges page messages to the
host.

Code belongs here when it is standalone-specific presentation or transport. The
views, rendering, and interaction the extension also uses come from the shared
packages; adding a product feature here rather than there hides it from the
extension.

The VS Code API shim exists so shared code can call one interface regardless of
which host it runs under.
