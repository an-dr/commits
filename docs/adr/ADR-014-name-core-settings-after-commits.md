# ADR-014: Name core settings after Commits

> Supersedes the key-naming part of [ADR-009](ADR-009-separate-extension-compatible-and-desktop-settings.md). Its `core`/`app` split and single document stand.

## Problem

ADR-009 gave `core` the exact keys of VSCode Commits' manifest, so every core setting carried the prefix `an-dr-com-mit-s.`. That name is the extension's repository identifier, not a name a user recognizes, and it spread through the code, the settings dialog and the docs as an unexplained label. It also hid a real distinction: about a dozen of the 40 settings mean something only inside VS Code (SCM buttons, status bar, inline blame), yet they looked exactly like the settings both apps read.

## Decision

Core settings are named after Commits:

- `commits.<name>` for a setting both the standalone app and VSCode Commits read;
- `commits-vsc.<name>` for a setting only VSCode Commits reads, which the standalone app keeps so the document still holds the full catalog.

The settings document moves to version 3. A version 2 document is migrated on read by renaming its `an-dr-com-mit-s.` keys, unknown ones included, so no value is lost. The catalog checker matches settings by name, so it accepts the extension's manifest under either prefix.

VSCode Commits is expected to adopt the same names. Until it does, an entry copied between the two apps' settings files needs its prefix changed.

## Rationale

A key should say what it belongs to. `commits.` names the product a user installed, and `commits-vsc.` marks a setting the standalone app stores without using it, which a reader of the file otherwise has no way to tell. The rename is cheap now, while one person owns both the app and the extension.

## Rejected alternatives

- Keep `an-dr-com-mit-s.`: copying settings works today without changes, but the opaque name stays in every file and dialog, and so does the hidden VS Code-only distinction.
- Rename every key to `commits-vsc.`: one prefix and a clear origin, but settings the standalone app depends on would carry a VS Code name.
- Drop the VS Code-only settings from `core`: a smaller file, but saving it would delete values a user copied from VS Code, and the document would no longer be the extension's full catalog.
