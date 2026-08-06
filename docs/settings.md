# Standalone settings

The Settings button opens the application editor. It reads and atomically
replaces one UTF-8 document at `~/.commits/settings.json` (`%USERPROFILE%` is
the home directory on Windows). A missing or malformed file loads defaults;
the app reports read and write failures in the dialog.

## Document format

The document separates portable extension settings from desktop appearance:

```json
{
  "version": 2,
  "core": {
    "an-dr-com-mit-s.autoCenterCommitDetailsView": true,
    "an-dr-com-mit-s.initialLoadCommits": 300,
    "an-dr-com-mit-s.graphStyle": "rounded"
  },
  "app": {
    "mode": "system",
    "lightTheme": "paper",
    "darkTheme": "graphite",
    "timeFormat": "system"
  }
}
```

`core` contains all 40 keys from the MIT extension's
`contributes.configuration` manifest. Keys are fully qualified and their
defaults, enums, arrays, and object values match `an-dr-com-mit-s`, so an entry
can be copied directly between `core` and VS Code's user `settings.json`.
Known invalid values fall back independently; they do not reset the rest of
the document. Unknown keys in `core` and `app` survive an editor save so newer
schema additions remain forward-compatible.

The desktop graph currently applies the shared webview settings: graph
colours/style, commit-loading counts, date format, author visuals, density,
columns, branch-panel layout, refresh shortcut, current-branch behavior, and
dialog behavior. Settings for VS Code-only surfaces—SCM buttons, status bar,
inline blame, tab icon, logging, repository search, and date selection in the
extension host—are stored compatibly but have no standalone surface yet.
`dateFormat`'s "Date Only" and "Relative" options are one such case in
practice: the value still round-trips through `core`, but neither the Dev
column's visible text nor its tooltip depends on it any more. The column
always shows the fixed today-or-ISO-date format below, since a column of
constant width cannot also show a variable-length string like a relative age.

## Appearance

`app.mode` is `system`, `light`, or `dark`. System mode follows operating-system
changes live. `lightTheme` and `darkTheme` are always stored separately, so
switching modes never discards either choice.

`app.timeFormat` is `system`, `12h`, or `24h`, and controls the hour cycle used
by the compact commit-date column: `system` resolves the 12/24-hour convention
from the display locale (`Intl.DateTimeFormat`'s default), while `12h`/`24h`
force one regardless of locale. This is a desktop-only display preference with
no equivalent in the MIT extension's settings, which is why it lives in `app`
rather than `core`.

| Light presets | Dark presets |
| --- | --- |
| Paper (`paper`) | Graphite (`graphite`) |
| Solarized Light (`solarized-light`) | Midnight (`midnight`) |
| High Contrast Light (`high-contrast-light`) | High Contrast Dark (`high-contrast-dark`) |

Appearance changes apply immediately after a successful save. Shared graph
configuration is read when the window opens and therefore applies after the
window is reopened.

## Migration and safety

The old version 1 `commitLimit` becomes
`an-dr-com-mit-s.initialLoadCommits`, and its `theme` becomes `app.mode`.
`includeRemotes` has no MIT manifest equivalent and is not copied into `core`.
Repository and view state remain in the Bones component save slot rather than
this user-facing file.

The trusted native host fixes the path, accepts requests only from the
`commits` component, writes a same-directory temporary file, flushes it, and
atomically replaces `settings.json`. The sandboxed component validates JSON
but never receives general filesystem access.

Run the catalog checker against an extension installation after updating the
MIT reference:

```powershell
npm run check:settings-compat -- C:\path\to\an-dr-com-mit-s
```
