# ADR-013: Publish stable contracts for callers

## Problem

Until 1.9.0 only a person started Commits, so its command line and files were private details it could change at will. Release 1.9.0 lets other programs drive it: a launcher or editor opens a repository at a branch or commit, hands a second launch to the running window, styles a session, offers its own repository lists, and shows the same health verdict beside its own UI.

Each of those is an interface someone else's code depends on. Without a recorded rule, a later change to a flag, a file field or a verdict would look like an internal refactor and break those callers silently.

The same release moved updates, desktop registration, the control channel and folder watching to Bones under [ADR-012](ADR-012-generic-capabilities-belong-upstream.md). The page server did not move. Why it exists is in [ADR-006](ADR-006-serve-the-webview-page-from-the-host-at-run-time.md) and BUG-005 in [techdebt.md](../techdebt.md), but not that it is an exception to ADR-012.

## Decision

Commits owns and publishes four caller contracts, each documented in `docs/` and kept stable:

| Contract | Document | Held by |
| --- | --- | --- |
| Command line and single-window handoff | [command-line.md](../command-line.md) | parser tests and the usage test |
| Repository health facts, rules and verdicts | [repository-health.md](../repository-health.md) | [conformance vectors](../repository-health.vectors.json) |
| Repository source files | [repository-sources.md](../repository-sources.md) | source module tests |
| Session theme files | [themes.md](../themes.md) | theme file tests |

Files carry an integer `version`. Commits reads version 1, ignores unknown fields, and skips a file whose version is higher than it understands. Unknown flags and invalid values are ignored rather than refused. A change that would break an existing caller needs a new version, or a new flag, not an edit of the old meaning.

The page server stays in this repository as a recorded exception to ADR-012. The Bones version Commits pins cannot answer HTML panels off the window thread (BUG-005), so the local server remains until it can; then it moves upstream like the rest.

## Rationale

A caller can only rely on what is written down and tested. Documenting each contract in one place, with tests or vectors that fail when the code drifts from it, turns "please don't break this" into a check. The health contract goes furthest, because other tools are expected to reimplement it: its vectors let them test their own verdict function against ours.

Ignoring unknown fields and flags lets Commits add to a contract without breaking older callers, and lets newer callers run against an older Commits. Skipping files of a higher version avoids misreading a format that has changed meaning.

## Rejected alternatives

- **Keep these interfaces undocumented and internal.** That gives no caller anything to build on, and the first rename would break them without warning.
- **Refuse unknown flags and fields.** That is stricter, but it makes every addition a breaking change for whichever side is older.
- **Move the page server to Bones now.** The pinned Bones cannot answer HTML panels off the window thread, so there is nothing upstream to move it onto yet.
