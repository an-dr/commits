# Roadmap

Where Commits goes next. What exists today is described in [docs/architecture.md](docs/architecture.md), and what has shipped is in the [changelog](CHANGELOG.md).

## Goal

One core, two hosts. The repository and graph logic shared in `packages/` should serve both this desktop app and VSCode Commits, so a fix lands once and reaches both.

## Next: the extension adopts the shared core

| Step | Done when |
| --- | --- |
| Publish `packages/core` as a consumable package, through a workspace or Git dependency | A scratch project pins and consumes one version |
| Implement `HostPort` for VS Code in the extension repository | The extension starts against the shared core |
| Cut `an-dr-commits` over to the shared core and delete its duplicated logic | The extension's test suites pass against the shared core |
| Consume the shared web bundle from both hosts | One frontend codebase serves both |
| Release both products from one version stream | Both ship from a single tag |

The extension can take this repository as a submodule, in place of its tracked `packages/core`:

```text
extensions/an-dr-com-mit-s/
└── packages/
    └── commits/          git submodule -> an-dr/commits
        └── packages/
            ├── core/             @an-dr/commits-core
            └── webview-shell/    shared DOM, localization, and CSS
```

Its workspace, TypeScript path alias, test alias, and esbuild resolver then point at both packages below `packages/commits`. The extension host supplies `vscode.l10n.t` to `createLocalizedStrings()` and uses `buildGraphShell()` for its body.

## Not built yet

- macOS builds; CI builds Windows x64, Windows ARM64, and Linux x64.
- An in-app log viewer; diagnostics are written to `commits.log` ([troubleshooting](docs/troubleshooting.md)).
- A tray icon.
- A decision on inline blame and code review, which are editor-bound in the extension; their settings are stored but have no standalone surface ([settings](docs/settings.md)).
- Performance figures for a very large repository, such as 100,000 commits.

## Out of scope

- Git operations `git` itself cannot perform, such as custom merge algorithms or in-app conflict resolution beyond invoking a merge tool.
- Hosting-provider integrations beyond the existing pull-request URL templates.
- bones' renderer, egui, audio, or game-core paths; Commits uses only the web panel.
