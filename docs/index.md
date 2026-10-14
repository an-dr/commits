# Documentation

New to the project? Start with the [README](../README.md) to try the app, then the [contribution guide](../CONTRIBUTING.md) to build it and submit a change. What changed in each version is in the [changelog](../CHANGELOG.md).

## Using Commits

- [Settings](settings.md) — persisted options, appearance, and external tools.
- [Desktop integration](desktop-integration.md) — application registration and folder actions.
- [Self-updating](updating.md) — installation, release manifests, update, recovery, and publishing a release.
- [Syntax highlighting](syntax-highlighting.md) — languages and limits in the diff panel.
- [Troubleshooting](troubleshooting.md) — first checks and diagnostic logs when the app does not start correctly.

## Driving Commits from another program

- [Command line](command-line.md) — paths, single-window handoff, navigation, and session appearance.
- [Session themes](themes.md) — the palette file format.
- [Repository sources](repository-sources.md) — repository lists shown in the selector.
- [Repository health](repository-health.md) — verdict rules and their conformance vectors.

These contracts are kept stable as recorded in [ADR-013](adr/ADR-013-publish-stable-contracts-for-callers.md).

## Building and contributing

- [Architecture](architecture.md) — layers, boundaries, native endpoints, and repository layout.
- [Shared core](shared-core.md) — what `packages/core` is and where it differs from upstream.
- [Continuous integration](ci.md) — Docker builds, local CI runs, and Windows cross-compilation.
- [Architecture decisions](adr/) — settled decisions about the core, host, engine, settings, and licensing.
- [Technical debt](techdebt.md) — known limitations and their tracking entries.
- [Roadmap](../ROADMAP.md) — what comes next.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — upstream lineage and licenses.

The [`vendor/bones` documentation](../vendor/bones/README.md) is the authority for engine protocols and runtime behavior.
