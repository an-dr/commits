# Self-updating the standalone app

The standalone build can check a hosted manifest for a newer version,
download and checksum-verify it, and apply it on the next launch — with an
automatic fallback to the previous version if the new one fails to start.
This document is the publisher's and operator's reference; see
[`ADR-005`](adr/ADR-005-use-correlated-bus-replies-for-long-native-work.md)
for why the check and download run as correlated, non-blocking bus requests
rather than synchronous calls.

## Install layout

An installation the launcher can update looks like this:

```text
~/.commits/
  app/
    commits.exe           # the permanent entry point -- stable name, replaced
                           # in place by the app when a version ships a newer one
    1.2.0/                 # a version folder: commits-app.exe, commits-launcher.exe,
                           # page.html, components/, ...
    1.3.0/                 # the current version -- the highest by folder name
    state/                   # user save data, shared across every version -- also
                             # holds updater.bin, the version last recorded for the
                             # "Updated to X" banner (see "Confirming an update took
                             # effect" below)
  settings.json
  repo/                     # the commits project's own clone (Clone Commits Repo)
```

`commits.exe`, not `commits-app.exe`, is the permanent entry point: Start
Menu and desktop shortcuts point at it, and it is the name users type. On
every start it picks the current version folder -- the highest by name under
`app/` -- and launches that version's `commits-app.exe`. There is nothing to
apply first: installing a version means its folder already exists, so the
very next start already sees it as the newest one on disk.

## The two processes replace each other

Neither process can replace itself while it is running, so each replaces the
other. The launcher swaps the app by picking a different version folder on
its next start. The app swaps the launcher by writing over the file at the
install root — which is why every version folder also carries
`commits-launcher.exe`, the launcher that shipped with that version.

The name changes on the way in. The payload is `commits-launcher.exe` and
the entry point is `commits.exe`: they live in one tree during an install,
and what belongs inside a version folder is decided by filename, so sharing
a name would quietly drop the launcher from every payload.

On startup the app compares the two. If they differ, it renames the current
entry point to `commits.exe.old` and copies the shipped one into place —
renaming rather than overwriting, because Windows refuses to overwrite a
running image but allows renaming one, and the launcher that started this
very process may still be alive. A later start deletes the leftover, once
nothing is executing it.

This direction used to be missing, and its absence was not theoretical: an
install rewrote the version folder underneath the entry point and never the
entry point itself, so `commits.exe` stayed whatever version first created
it. A launcher bug — including one that dropped the command-line argument
before the app ever saw it — could not be fixed by any number of updates.

A version folder that carries no `commits-launcher.exe` is left alone. Every
folder installed before this release looks like that, and none of them is an
error.

Only the current and previous version folders are kept; anything older is
deleted once a new one is installed. `components/` (the built-in WASM
components) is versioned along with the rest of a version folder -- updated
with every release, and cleaned up automatically along with its version once
pruned -- rather than shared. `state/` is different: it must survive an
update, so it sits outside every version folder instead. This is purely
structural, not tied to `~/.commits/app` specifically: `commits-app.exe`
resolves `state/`'s location by checking whether its own directory's name
parses as a version and its parent has a launcher beside it, so a `dist/app`
build assembled the same way (see [`phase-0-1.md`](phase-0-1.md)) behaves
identically without any extra configuration.

## The manifest

`app.updateManifestUrl` (see [`settings.md`](settings.md)) points at a small
hosted JSON document:

```json
{
  "version": "1.3.0",
  "url": "https://example.com/releases/commits-1.3.0.zip",
  "sha256": "…64 hex characters…"
}
```

- `version` is compared against this build's own `CARGO_PKG_VERSION`
  (`apps/commits/host/Cargo.toml`'s `[package] version`) using a
  dot-separated numeric comparison — `1.2.0` reads as older than `1.10.0`,
  not lexically. A release therefore needs that version bumped, or every
  later build will keep reporting itself up to date. The same comparison,
  applied to version folder names instead of a manifest field, is also how
  the launcher picks which installed version is current.
- `url` is a ZIP of a version's contents (`commits-app.exe`, the other
  helper executables, `commits-launcher.exe`, `page.html`, and a
  `components/` folder for any WASM component being updated). Include the
  launcher: it is how a launcher fix reaches an existing install, and a
  payload without one simply leaves whatever entry point is already there.
  Never name it `commits.exe` inside the ZIP — that is the entry point's
  name, not the payload's.
- `sha256` is optional but recommended: when present, a downloaded asset
  that does not match is refused outright rather than installed. Omitting
  it is a deliberate choice for a publisher who cannot commit to a checksum
  immediately, not a silent weakening — always set it when you can.

Publish the manifest and the ZIP together and update `version`/`url`/`sha256`
as the last step of a release, once the asset itself is final.

## What happens on click

"Update to `<version>`" appears in the app menu only once a check finds a
manifest version newer than the running build. Clicking it re-fetches the
manifest, downloads and verifies the asset, and extracts it into its own new
version folder under `app/`, `components/` and all — all on a background
thread, so the window stays responsive. If a version folder by that name
already exists (a dev build that never bumped its version, most commonly),
the new one gets a short content-hash suffix rather than overwriting it. The
menu label then switches to "Restart to update"; the new version becomes
current only once `commits.exe` is started again and finds it as the newest
folder on disk. That start also refreshes the entry point itself, if the new
version brought a different launcher with it.

## Install: pushing a running build without a manifest

"Install" appears in the app menu instead, whenever this run's own directory
is *not* a version folder under `~/.commits/app` — a dev build, or a build
launched ad hoc rather than through the installed `commits.exe`. It needs no
manifest URL or network access at all, and does one of two things depending
on whether `~/.commits/app` already has a launcher in it:

- **Already installed** (some version is there): copies this run's own
  directory into a new version folder, the same way a downloaded update
  does. The label switches to "Restart to install"; the existing
  `~/.commits/app/commits.exe` picks it up as current the next time it
  starts, and that start replaces the entry point too if the pushed build
  carries a different launcher.
- **Nothing installed yet**: there is no launcher yet to ever pick up a
  pushed version folder, so this places the launcher at `~/.commits/app`
  itself and the rest of the build into its own first version folder. This
  already completes the install; the entry disappears rather than prompting
  a restart. Run `~/.commits/app/commits.exe` (or use
  [`scripts/install.ps1`](../scripts/install.ps1), which also sets up
  shortcuts) to actually start it.

## Launch

On every start, `commits.exe` (the launcher):

1. Picks the current version folder under `~/.commits/app` — the highest by
   name, the same comparison the manifest check uses.
2. Launches that version's `commits-app.exe`, forwarding its own arguments
   unread, and exits.

It does not supervise what it started. It used to: it waited up to 45
seconds for a health marker and, failing to see one, deleted that version's
folder and fell back to the previous one. That check measured wall clock, so
it could not tell a slow machine from a broken build — and being wrong meant
deleting a version that worked. A guess that destructive, made on every
launch, cost more than the recovery it bought.

Recovering from a version that genuinely cannot start is a deliberate act
now. Both version folders are still on disk (see "Install layout"), and the
previous one becomes current again the moment the newest is removed:

```powershell
commits --rollback
```

It refuses when the newest is the only version installed, since deleting it
would leave the entry point with nothing to start at all.

## The command line

The launcher answers three flags itself and forwards everything else to the
app unread — a repository path, and anything a later app learns to take. A
flag counts only as the first argument, which costs nothing, because no path
the app opens begins with a dash.

| Flag | Does |
| --- | --- |
| `--version` | prints the installed app version and the launcher's own build |
| `--help` | prints usage |
| `--rollback` | drops the newest version folder for the previous one |

The launcher answers them rather than the app because it is the process the
shell waits on: the app is spawned detached with no stdio, so nothing it
printed could reach the terminal.

`--version` prints both numbers because the interesting answer is whether
they agree. A launcher left behind by an old install starts a perfectly
current app while being years out of date itself, and nothing else makes
that visible:

```text
commits 1.1.0
launcher 1.0.1     # this pair disagreeing is the bug, not a display quirk
```

`unknown` for the launcher means the build never stamped
`UPGRADER_LAUNCHER_VERSION` — see [`.cargo/config.toml`](../.cargo/config.toml).

Both binaries are GUI-subsystem executables, so they own no console. The
launcher borrows the calling terminal's to answer, and prefers a redirect
when the caller supplied one, so `commits --version > versions.txt` writes
to the file rather than to the screen. Started from Explorer there is
neither, and the text goes nowhere — which is correct, since nobody asked
for it.

A launch that only prints to standard output/error and opens no window
failed before startup could begin. When `commits-app.exe` itself starts but
the window stays blank, its own failed-startup dialog names the log path;
see "Troubleshooting a blank window" in the [README](../README.md).

## Confirming an update took effect

The app records its own version on every start through bones' own
`persistence` module (`wasm_extensions::persistence::Persistence`, the same
mechanism a WASM extension uses to save its own state) — a `persistence/save`
publish keyed by the `updater` module's own bus name, landing at
`state/updater.bin`, no separate on-disk state of this crate's own to manage.
It compares that against what it last recorded, read back via a direct `send`
to the `persistence` endpoint. The first start after that comparison changes
— a version that differs from last time, however it got there (a downloaded
update or a direct Install) — shows "Updated to version X" once next to the
menu button. A first run ever (no prior save) does not trigger this; there is
nothing to compare yet.

## Checking behavior locally

Point `updateManifestUrl` at a manifest whose `version` is higher than the
running build's, served from anywhere reachable over HTTPS (a local static
file server works for testing). `COMMITS_INSTALL_DIR` can redirect the
install location to a scratch directory instead of the real `~/.commits/app`
while testing the launcher directly.
