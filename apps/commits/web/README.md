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

The repository overlay lists recently opened repositories, which the core sends
with its request for a repository. Paths are inserted as text, never markup,
because a path is arbitrary input arriving from persisted state.

Startup uses two readiness messages. The page first receives and applies
settings, then mounts the shared view and announces that repository messages
can be delivered. This keeps initial graph configuration deterministic.

The settings dialog is generated from the MIT compatibility catalog. Its app
section selects independent light and dark presets plus system/light/dark mode;
the appearance controller maps the active preset to the VS Code variables that
the shared webview consumes.
