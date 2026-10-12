# Command line

The installed `commits` launcher starts the latest installed app and forwards its arguments and working directory. The unpacked `commits-app` accepts the same application arguments.

```text
commits [<path>] [--show changes|conflicts|graph] [--branch <name>] [--commit <sha>] [--theme light|dark] [--theme-file <file>]
```

`<path>` names a repository or a folder containing repositories, relative to the caller's working directory. Flags accept a separate value or `--name=value`. Unknown flags and unknown values are ignored. A missing value is ignored without consuming the next flag.

## Navigation

`--show changes` selects working-tree changes. `--show conflicts` selects the same row and preserves the existing unfinished-operation banner. `--show graph` opens the graph. `--branch` selects a branch tip; `--commit` selects a commit and takes precedence over a branch. Commit identifiers must contain 4–64 hexadecimal characters. Navigation waits for the repository to load. Missing targets produce a non-modal notice; history is searched up to `app.navigationMaxCommits` (10,000 by default, editable in `settings.json`).

## One window

A second launch for the same user hands its arguments and working directory to the running instance, exits successfully, and raises that window. The newest pending request is applied after any current repository load. If handoff fails or times out after two seconds, the new process opens its own window.

## Appearance

`--theme` selects a session mode; `--theme-file` supplies a [theme file](themes.md). Neither writes settings. A handoff without these flags keeps the current session override. A handoff supplying a flag replaces that part of the override. Appearance changes made in Settings take effect during the session.

## Launcher flags

When first, `--version` prints the installed app version and launcher version, `--help` prints usage, and `--previous` starts the previous installed build for recovery. Other flags reach the app. Rollback is performed by the app's upgrade module; the launcher never deletes versions. Both version stamps are kept equal when releasing the app.

See [self-updating](updating.md) for installation and release publishing.
