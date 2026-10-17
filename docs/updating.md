# Self-updating the standalone app

Commits uses Bones’ upgrade module to check its release manifest, download and verify a release, and install it in a new version folder. Work runs off the window thread through correlated `upgrader/request` and `upgrader/result` messages. The permanent launcher selects an installed build and exits; it does not supervise the app or delete versions.

## Install layout

```text
~/.commits/
  app/
    commits.exe
    1.8.1/
    1.9.0/
      commits-app.exe
      commits-launcher.exe
      page.html
      components/
    state/
  settings.json
  sources/
```

Linux executable names omit `.exe`. The launcher at the install root is the stable entry point used by desktop registration. Every version carries its own `commits-launcher` payload; the app refreshes the entry point from it on startup. `state` is shared across installed versions. `COMMITS_INSTALL_DIR` redirects the installation to a scratch folder.

Versions use strict SemVer precedence; build metadata alone does not make an update newer. A second installation of the same version uses a `version~instance` folder instead of overwriting the existing build. bones retains the current and previous versions.

## Release source

The default source is the latest GitHub release of `an-dr/commits`. Its platform manifests are `commits-linux-x64.json`, `commits-windows-x64.json`, and `commits-windows-arm64.json`. The host fixes the source when it composes the upgrade module. `app.updateManifestUrl` overrides it; an empty value selects GitHub. Restart the app after changing this setting so the host reads the new source. A guest can request an action but cannot choose a release URL.

```json
{
  "version": "1.9.0",
  "url": "https://example.com/commits-1.9.0.zip",
  "sha256": "64 hexadecimal characters"
}
```

The ZIP contains the version's executables, `page.html`, `components/`, and the launcher payload named `commits-launcher`, never the installed entry-point name `commits`. Publishing scripts always include a SHA-256 checksum. The bones module owns HTTPS and the 256 MiB download limit, independent of the generic `os` fetch cap. Extracted Linux executables regain execute permission.

## App menu

Check finds a newer manifest and offers Update. Update downloads and stages it, then offers Restart; the launcher selects the new folder on the next run. Install and register copies an unpacked build into the canonical install, then registers its entry point through Bones’ separate desktop module. Registration failure leaves the installed files intact and reports the failure. The installed app can retry Register with system. Unregister removes desktop integration and keeps installed files.

The app asks bones for the version previously recorded under the `upgrader` persistence key. A changed version produces the one-time Updated notice. First runs and development builds do not claim they were updated.

## Recovery and command line

The [command-line contract](command-line.md) owns all flags, path handling and single-instance behavior. Use `commits --previous` to start the previous installed build when a newer build cannot start. The launcher never deletes a build. Recovery mutations belong to the app's upgrade module.

## Publishing a release

Bump `apps/commits/host/Cargo.toml` and `UPGRADER_LAUNCHER_VERSION` in `.cargo/config.toml` together, and move the [changelog](../CHANGELOG.md)'s Unreleased entries under the new version and date in the same commit. After that commit is on `main`, push the matching tag:

```sh
git tag v1.9.0
git push origin main v1.9.0
```

The [build workflow](../.github/workflows/build.yml) builds Linux x64, Windows x64 and Windows ARM64. [Package release](../scripts/package-release.ps1) publishes `commits-<version>-<platform>.zip` and `commits-<platform>.json` for each platform: six assets total. It refuses a tag that does not match the app version. Other pushes retain build artifacts without publishing a release.

## Checking behavior locally

Build and assemble with `npm run dist`. [Install](../scripts/install.ps1) installs files without registration. Set `app.updateManifestUrl` to a test manifest served over HTTPS and restart to exercise the updater. Set `COMMITS_INSTALL_DIR` to keep the experiment outside the normal installation. The [desktop integration](desktop-integration.md) page describes registration separately.
