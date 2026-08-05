# ADR-009: Separate extension-compatible and desktop settings

## Problem

The standalone app needs the same configuration values as the MIT VS Code
extension, but it also needs desktop-only appearance preferences. Mixing those
preferences into the extension namespace would make the shared contract drift,
while separate files would make a single settings edit non-atomic.

## Decision

Store one versioned document at `~/.commits/settings.json` with a `core` object
and an `app` object. `core` uses the MIT extension's complete, fully-qualified
configuration keys and value shapes. `app` owns display mode and independent
light- and dark-theme selections.

The native host owns path resolution and atomic file replacement. The Bones
adapter validates and migrates documents, and the standalone page renders the
editor and applies the resulting settings. Unknown `core` keys survive saves so
a newer extension schema remains forward-compatible.

## Rationale

Fully-qualified keys can be copied to or from VS Code's `settings.json`
without translation and cannot be confused with desktop settings. A single
document is easy to inspect and back up. Keeping filesystem access in the
trusted native host preserves the existing host boundary.

## Rejected alternatives

- Put extension and desktop settings in one flat object: directly pasteable,
  but app keys can collide with future extension keys and ownership is unclear.
- Use separate `core.json` and `app.json` files: clean ownership, but updates
  are not atomic and users have two files to manage.
- Keep using Bones' component save slot: reuses existing persistence, but the
  file is named `commits.bin` beside the executable rather than the requested
  stable user path and is not a user-facing JSON contract.
