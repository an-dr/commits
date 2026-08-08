# ADR-010: Apply settings live via a shared-core update hook

## Problem

Saving settings only updated appearance (theme/mode); every other value fed
`GitGraphView` through a `Config` object copied once at construction and a
few module-init-time side effects (the density body class, the refresh-chord
listener), so a saved change to any of those needed the window reopened to
take effect. That lives entirely in `packages/core/src/webview`, same
boundary ADR-008 already crossed for multi-branch selection.

## Decision

Added a public `GitGraphView.updateConfig(partial: Partial<Config>)` that
`Object.assign`s into the existing `config` object rather than replacing it,
so the `Graph` renderer (which holds the same reference) picks up the change
without reconstruction. Extracted the one-shot `configFromViewState()`,
`applyUiDensity()`, and a mutable `refreshShortcutKey` out of
`startCommitsView`'s constructor call and the module-init density/shortcut
code, and exported a new `applyLiveSettings()` that re-reads the global
`viewState` through all three plus `gitGraph.refresh(false)`. The standalone
host calls it right after refreshing `globalThis.viewState` on
`standaloneSettingsSaved`. `configFromViewState()` deliberately omits `grid`:
`renderGraph()` recomputes its `y`/`expandY`/`offsetY` from live DOM
measurements on every render, so a live update must leave whatever is
already on `this.config.grid` alone rather than resetting it to the
construction-time default between the update and the next render pass.

## Rationale

Detailed Auto: made this call without a per-decision user gate, per the
"agent makes intermediate decisions" charter. `Object.assign` onto the
existing config avoids reconstructing `GitGraphView`/`Graph` (which would
drop selection, scroll position, and expanded-commit state) just to change a
handful of fields. Fields already read as bare `viewState.x` at each call
site (`columnVisibility`, `dateFormat`, `branchPanel*`,
`confirmAbortRepoInProgress`, `timeFormat`, `locale`) needed no core change at
all -- reassigning `globalThis.viewState` already reaches them.

## Consequences

Same as ADR-008: `packages/core` diverges further from the
`an-dr-com-mit-s` snapshot it was imported from, so a future re-import
conflicts here instead of applying cleanly. `applyLiveSettings` is additive
(no existing export changed shape), so a host that never calls it -- the VS
Code extension's own bundle -- behaves exactly as before.

## Rejected alternatives

- Reconstruct `GitGraphView` on every settings save: reuses no code, and
  loses in-memory view state (selection, scroll, expanded commit) that a
  live-apply is precisely meant to avoid disturbing.
- Leave the config-cached fields (`avatarMode`, `graphColours`, `graphStyle`,
  the commit-load counts, `showCurrentBranchByDefault`, `autoCenterCommitDetailsView`,
  `fetchAvatars`, `committedVisual`) stale until reopen, apply everything
  else live: partial coverage the user did not ask for, and the stale subset
  is exactly the settings most likely to be changed for their visible effect
  (colours, avatar mode).
