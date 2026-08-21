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
    "timeFormat": "system",
    "updateManifestUrl": ""
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

`app.updateManifestUrl` is empty by default, which keeps self-update off. See
[`updating.md`](updating.md) for the manifest format and what setting it
enables.

## External tools

`app["external-tools.tools"]` lists the programs the app can hand a repository
or a file to, and everything this feature owns lives under that
`external-tools.` division. A
fresh install ships with VS Code configured, so the Open in button is there to
be found; emptying the list removes the button and returns the file tree's
double click to the built-in diff panel. A settings document written before
tools existed says nothing about them and takes the default, rather than
losing the feature without a word.

```json
"external-tools.tools": [
  {
    "name": "VS Code",
    "command": "code",
    "openArgs": ["{repo}"],
    "diffArgs": ["--diff", "{left}", "{right}"]
  }
]
```

`command` is the program, looked up on `PATH` or given as a full path.
`openArgs` and `diffArgs` are argument vectors rather than command lines: each
entry is passed to the program as one argument, so a path containing a space
needs no quoting and a file name containing a shell metacharacter cannot start
a second command. A tool with an empty `openArgs` is not offered by the Open in
button, and one with an empty `diffArgs` is never used for a diff.

Three placeholders are substituted:

| Placeholder | Becomes | Substituted by |
| --- | --- | --- |
| `{repo}` | the open repository's path | the page, which knows the repository |
| `{left}` | the older revision of the file | the host, which writes the file |
| `{right}` | the newer revision of the file | the host, which writes the file |

The diff placeholders are files the host writes into a temporary directory,
one per side, because the revisions being compared exist as objects in the
repository rather than as files on disk. They keep the file's own name, so the
tool's title bar reads as the user expects, and they are left behind for the
tool to read for as long as it needs them.

The first tool in the list is the one the Open in button runs when clicked;
the rest are offered under its chevron, which also carries "Configure tools" —
so the list is reachable even when only one tool is set up. The first tool with
a non-empty `diffArgs` is the one a double-clicked file opens in. At most five
tools are kept, whatever the file lists.

A document written before the key was namespaced is still read: a bare `tools`
key is used when `external-tools.tools` is absent, and the namespaced key is
what gets written back.

A tool without a `command` is dropped when the file is read, and its
neighbours are kept, the same way an invalid `core` value falls back on its
own.

The settings editor gives external tools their own section: one card per
tool, each with a `VS Code` or `Custom` selector, a name, a command, and the
two argument fields, an argument to a line. Cards can be added up to the limit
and removed individually; removing the last one leaves no button, which is a
legitimate choice. Choosing `VS Code` fills the fields and locks them rather
than hiding them, so the preset is not a black box; a tool whose command
matches the preset but whose arguments do not reads as `Custom`, so
re-selecting the preset cannot quietly overwrite an edit.

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
