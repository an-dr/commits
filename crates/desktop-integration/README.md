# desktop-integration

Registers an installed application with the desktop it runs on, and removes that registration again. Registration is what makes an application more than a folder of executables: an entry in the system's application list, and a way to open a folder in it from the file manager. Nothing here copies, moves, or deletes the application's own files; an unregistered application is simply portable.

The crate knows nothing about git or about Commits. Everything that names the application is an input, so it can serve any host unchanged — which is also why it belongs in `bones` rather than here (see [`crates/README.md`](../README.md)).

## What a registration is

An `Integration` describes the application:

| Field | Meaning |
| --- | --- |
| `id` | Stable machine name, used for file and key names (`commits`) |
| `name` | Name shown in the application list (`Commits`) |
| `comment` | One-line description shown beside the name |
| `open_label` | Label of the folder action (`Open in Commits`) |
| `executable` | Absolute path of the program to start; a folder is passed as its only argument |
| `icon_png` | PNG bytes of the application icon |

`register` writes every part, `unregister` removes every part, and `is_registered` reports whether every part is present. Both writes are idempotent: registering twice leaves one registration, and unregistering something that is not registered succeeds. A registration with only some of its parts present counts as not registered, so registering again is how it is repaired.

Every location is resolved through `Locations`, which a caller normally takes from `Locations::for_current_user()`. Tests point it at a scratch directory instead, so nothing reaches the real desktop.

## Linux

Registration follows the freedesktop.org specifications, per user and with no elevated rights:

| Part | Location |
| --- | --- |
| Desktop entry | `$XDG_DATA_HOME/applications/<id>.desktop` |
| Icon | `$XDG_DATA_HOME/icons/hicolor/256x256/apps/<id>.png` |

`$XDG_DATA_HOME` defaults to `~/.local/share`. The desktop entry makes the application appear in the application list, and its `MimeType=inode/directory;` makes it an "Open With" choice for folders in file managers that read desktop entries, including GNOME Files (Ubuntu, Pop!_OS 22.04) and COSMIC Files (Pop!_OS 24.04). `Exec` passes the chosen folder as `%f`, and starting the application from the list passes nothing.

After writing or removing the entry, the crate runs `update-desktop-database` on the applications directory, and `gtk-update-icon-cache` on the icon theme when that theme already has a cache, so file managers see the change without a new login. A cache is never created where there was none, since it would hide icons that other applications install later without refreshing it. Both tools are best effort: a desktop without them still reads the files directly, so a missing tool is not an error.
