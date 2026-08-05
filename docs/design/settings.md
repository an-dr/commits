# Settings design

The standalone settings boundary follows [ADR-009](../adr/ADR-009-separate-extension-compatible-and-desktop-settings.md).

The native `settings` module reads and atomically replaces
`~/.commits/settings.json`. The module does not interpret JSON. The Bones
adapter owns schema migration and validation, and sends a normalized document
to the standalone webview before the shared graph view starts.

The version 2 document has two ownership domains:

```json
{
  "version": 2,
  "core": {
    "an-dr-com-mit-s.autoCenterCommitDetailsView": true
  },
  "app": {
    "mode": "system",
    "lightTheme": "paper",
    "darkTheme": "graphite"
  }
}
```

`core` contains the full MIT extension configuration catalog. Keys and values
match its VS Code `contributes.configuration` declarations, including settings
that only take effect when the standalone app gains the corresponding host
surface. Known keys are validated independently and fall back to their shipped
defaults; unknown keys are preserved when the document is saved.

`app.mode` is `system`, `light`, or `dark`. Light and dark selections are
stored independently, so switching the operating-system preference does not
discard either choice. Theme presets are identifiers resolved by the page into
CSS-variable palettes; theme definitions are application code rather than user
data.

Version 1 standalone settings are migrated on load. Their commit limit maps to
the extension's initial-load setting and their theme maps to app mode. Existing
Bones state remains dedicated to repositories and view state; settings no
longer share that save slot.

Failures are recoverable: a missing file yields defaults, malformed JSON is not
overwritten until the user explicitly saves, and a failed native write is
reported in the settings dialog. Writes use a sibling temporary file followed
by rename so an interrupted save does not leave a partial document.
