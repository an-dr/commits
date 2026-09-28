# Desktop integration

An installed Commits can register itself with the operating system, so it appears in the application list and can open a folder straight from the file manager. Registration is always an explicit menu action and never a side effect of starting the app or of an update. Unregistering removes every trace of it from the operating system and leaves the files where they are, so an unregistered install is simply a portable app that happens to live in `~/.commits/app`.

There is no setting for this. Registration is a fact about the machine, not a preference the app reads, and `settings.json` is shared with every portable copy that should never register anything.

## What registration writes

Only the installed entry point is ever registered: `~/.commits/app/commits.exe` on Windows and `~/.commits/app/commits` on Linux. It is the one path that survives updates (see [`updating.md`](updating.md)), so a registration made once keeps working across every later version. A portable copy is never registered.

| Operating system | Registration |
| --- | --- |
| Windows | "Open in Commits" on a folder and on a folder's background, a Start Menu shortcut, and a desktop shortcut |
| Linux | An application-list entry that is also the "Open With" choice for folders, and its icon |

On Windows the folder actions are classic shell verbs under `HKEY_CURRENT_USER`, so no administrator rights are needed; Windows 11 lists them under "Show more options". On Linux the application-list entry declares folders as a type it opens, which is how GNOME Files (Ubuntu, Pop!_OS 22.04) and COSMIC Files (Pop!_OS 24.04) offer it under "Open With". The exact keys and files are listed in [`crates/desktop-integration`](../crates/desktop-integration/README.md), which does the work.

Opening a folder this way starts Commits with the folder as its argument, exactly as `commits <folder>` does from a terminal: the repositories at or below it are opened.

## The menu

The app menu shows at most one of these, depending on how the app is running:

| This run | Entry | Does |
| --- | --- | --- |
| Not the installed copy | Install and register | Installs this build, as described in [`updating.md`](updating.md), then registers the installed entry point |
| Installed, not registered | Register with system | Registers the installed entry point |
| Installed, registered | Unregister from system | Removes the registration; no file is deleted |

A registration with only some of its parts present — a deleted shortcut, a removed icon — counts as not registered, so "Register with system" is also how a damaged registration is repaired.

When an install succeeds but its registration fails, the install is kept and the failure is reported beside the menu; "Register with system" in the installed app retries it. [`scripts/install.ps1`](../scripts/install.ps1) installs files only and never registers.

## The wire

Register and unregister are actions on the updater's correlated request topic, next to check, stage, and install:

| Action | Tag | Does |
| --- | --- | --- |
| `check` | 0 | Compares the manifest with this build |
| `stage` | 1 | Downloads and stages a newer version |
| `install` | 2 | Installs the running build, then registers it |
| `register` | 3 | Registers the installed entry point |
| `unregister` | 4 | Removes that registration |

The synchronous install-status query answers `[SUCCESS, installed, just_updated, registered, ...version]`; `registered` is only ever set for an installed run. An `install` result with `ok` set and a non-empty `error` means the files were installed and the registration failed.
