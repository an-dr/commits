# Documentation

New to the project? Start with the [README](../README.md) to try the app, then the [contribution guide](../CONTRIBUTING.md) to build it and submit a change.

## Using Commits

- [Settings](settings.md) — persisted options, appearance, and external tools.
- [Troubleshooting](troubleshooting.md) — first checks and diagnostic logs when the app does not start correctly.
- [Desktop integration](desktop-integration.md) — application registration and folder actions.
- [Self-updating](updating.md) — installation, release manifests, update, and rollback.
- [Syntax highlighting](syntax-highlighting.md) — languages and limits in the diff panel.

## Building and contributing

- [Continuous integration](ci.md) — Docker builds, local CI runs, and Windows cross-compilation.
- [Repository layout](../ROADMAP.md#repository-layout-target) — intended boundaries and product direction.
- [Architecture decisions](adr/) — settled decisions about the core, host, engine, settings, and licensing.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — upstream lineage and licenses.

## Background and investigations

- [Phase 0–1](phase-0-1.md), [Phase 2–3](phase-2-3.md), and [Phase 4](phase-4.md) — implementation records and verification evidence.
- [Shared core](shared-core.md) and [webview transition](mit-webview-transition.md) — shared code boundary and transition plan.
- [Linux startup investigation](linux-startup-investigation.md) — diagnosis of earlier startup and responsiveness faults.
- [Settings design](design/settings.md) — extension-compatible and desktop settings boundary.
- [Technical debt](techdebt.md) — tracked limitations and follow-up work.

The [`vendor/bones` documentation](../vendor/bones/README.md) remains the authority for engine protocols and runtime behavior. Product-specific decisions live here.
