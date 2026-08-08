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

```
~/.commits/
  app/
    commits.exe           # the permanent entry point -- stable, not versioned,
                           # never touched by an update
    updater/               # the update state that isn't itself versioned
      version              # the version last recorded, for the "Updated to X" banner
    1.2.0/                 # a version folder: commits-app.exe, page.html, components/, ...
    1.3.0/                 # the current version -- the highest by folder name
    state/                   # user save data, shared across every version
  settings.json
  repo/                     # the commits project's own clone (Clone Commits Repo)
```

`commits.exe`, not `commits-app.exe`, is the permanent entry point: Start
Menu and desktop shortcuts point at it. On every start it picks the current
version folder -- the highest by name under `app/` -- and launches that
version's `commits-app.exe`. There is nothing to apply first: installing a
version means its folder already exists, so the very next start already
sees it as the newest one on disk.

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

`~/.commits/app/updater` is overridden by the `COMMITS_UPDATER_DIR`
environment variable, mainly for tests and support diagnostics.

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
  helper executables, `page.html`, and a `components/` folder for any WASM
  component being updated) -- never `commits.exe` itself, since the
  launcher is not part of what an update replaces.
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
folder on disk.

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
  starts.
- **Nothing installed yet**: there is no launcher yet to ever pick up a
  pushed version folder, so this places the launcher at `~/.commits/app`
  itself and the rest of the build into its own first version folder. This
  already completes the install; the entry disappears rather than prompting
  a restart. Run `~/.commits/app/commits.exe` (or use
  [`scripts/install.ps1`](../scripts/install.ps1), which also sets up
  shortcuts) to actually start it.

## Launch and fallback

On every start, `commits.exe` (the launcher):

1. Picks the current version folder under `~/.commits/app` — the highest by
   name, the same comparison the manifest check uses.
2. Launches that version's `commits-app.exe` and waits up to 45 seconds for
   it to report itself healthy — a marker file written once the engine's
   own 35-second startup grace period passes with no load failure.
3. If the marker never appears, kills the child, deletes that version's
   folder outright (there is nothing to restore — installing it never
   touched anything else), and relaunches the previous version folder once,
   unsupervised. With no previous version folder to fall back to, the
   broken one is left in place and the launcher gives up: there is nothing
   else installed to try.

A step that only sees standard output/error (no window) is a launch that
failed before startup could even begin; check `~/.commits` for a log path
reported by the failed-startup dialog if `commits-app.exe` itself started
but never became healthy.

## Confirming an update took effect

The app records its own version in `updater/version` on every start, and
compares it against what it last recorded. The first start after that
comparison changes — a version that differs from last time, however it got
there (a downloaded update or a direct Install) — shows "Updated to version
X" once next to the menu button. A first run ever on a machine (no prior
version recorded) does not trigger this; there is nothing to compare yet.

## Checking behavior locally

Point `updateManifestUrl` at a manifest whose `version` is higher than the
running build's, served from anywhere reachable over HTTPS (a local static
file server works for testing). `COMMITS_UPDATER_DIR` and
`COMMITS_INSTALL_DIR` can redirect the update marker and the install
location to scratch directories instead of the real `~/.commits/app` while
testing the launcher directly.
