# Self-updating the standalone app

The standalone build can check a hosted manifest for a newer version,
download and checksum-verify it, and apply it on the next launch — with an
automatic rollback if the new version fails to start. This document is the
publisher's and operator's reference; see [`ADR-005`](adr/ADR-005-use-correlated-bus-replies-for-long-native-work.md)
for why the check and download run as correlated, non-blocking bus requests
rather than synchronous calls.

## Install layout

An installation the launcher can update looks like this:

```
~/.commits/
  app/                  # the live install: commits.exe, commits-app.exe, extensions/, ...
  updater/
    update/             # a staged, verified download, applied on the next launch
    backup/             # the previous install, kept until the next successful apply
  settings.json
  repo/                 # the commits project's own clone (Clone Commits Repo)
```

`commits.exe`, not `commits-app.exe`, is the permanent entry point: Start
Menu and desktop shortcuts point at it. On every start it applies whatever
is staged in `updater/update/` (if anything) before launching
`commits-app.exe` — the real app logic — so an update is never applied
while the app it replaces might still hold its own files open.

`~/.commits/updater` is overridden by the `COMMITS_UPDATER_DIR` environment
variable, mainly for tests and support diagnostics.

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
  later build will keep reporting itself up to date.
- `url` is a ZIP of the install directory's contents (whatever `commits.exe`
  should overwrite `~/.commits/app` with).
- `sha256` is optional but recommended: when present, a downloaded asset
  that does not match is refused outright rather than staged. Omitting it
  is a deliberate choice for a publisher who cannot commit to a checksum
  immediately, not a silent weakening — always set it when you can.

Publish the manifest and the ZIP together and update `version`/`url`/`sha256`
as the last step of a release, once the asset itself is final.

## What happens on click

"Update to `<version>`" appears in the app menu only once a check finds a
manifest version newer than the running build. Clicking it re-fetches the
manifest, downloads and verifies the asset, and extracts it into
`updater/update/` — all on a background thread, so the window stays
responsive. The menu label then switches to "Restart to update"; nothing is
applied until the app (via `commits.exe`) is started again.

## Install: pushing a running build without a manifest

"Install" appears in the app menu instead, whenever this run's own directory
is *not* `~/.commits/app` — a dev build, or a build launched ad hoc rather
than through the installed `commits.exe`. It needs no manifest URL or
network access at all, and does one of two things depending on whether
`~/.commits/app` already has a launcher in it:

- **Already installed** (some version is there): copies this run's own
  directory into `updater/update/`, the same slot a downloaded update
  occupies. The label switches to "Restart to install"; the existing
  `~/.commits/app/commits.exe` picks the copy up and applies it — backup and
  health-check included — the next time it starts.
- **Nothing installed yet**: there is no launcher yet to ever apply a staged
  update, so the files go directly into `~/.commits/app` instead. This
  already-completes the install; the entry disappears rather than prompting
  a restart. Run `~/.commits/app/commits.exe` (or use
  [`scripts/install.ps1`](../scripts/install.ps1), which also sets up
  shortcuts) to actually start it.

## Apply and rollback

On the next start, `commits.exe` (the launcher):

1. Backs up `~/.commits/app` into `updater/backup/`, then copies
   `updater/update/` over it, leaving its own executable untouched in both
   directions (it cannot overwrite the file it is currently running).
2. Launches `commits-app.exe` and waits up to 45 seconds for it to report
   itself healthy — a marker file written once the engine's own 35-second
   startup grace period passes with no load failure.
3. If the marker never appears, kills the child, restores `updater/backup/`
   over `~/.commits/app` (again leaving the launcher's own executable
   alone), and relaunches the restored version once, unsupervised.

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
file server works for testing). `COMMITS_UPDATER_DIR` can redirect staging
and backup to a scratch directory instead of the real `~/.commits/updater`
while testing the launcher directly.
