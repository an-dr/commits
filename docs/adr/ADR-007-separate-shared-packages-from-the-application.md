# ADR-007: Separate shared packages from the application

Supersedes the directory placement stated in ADR-002. That decision's
substance — one wire contract verified by cross-language fixtures — still
holds; only the path changed, from `proto/` to `ipc/`.

## Problem

The application and the shared product core sat as peers at the repository
root, Rust and TypeScript directories interleaved, and two directories were
named for categories they did not belong to. `core/` held Bones-specific
adapter glue while the actual shared core lived in `packages/core`, and
`proto/` contained no Protocol Buffers. Nothing in the layout showed which code
the VS Code extension consumes and which exists only for the standalone app.

## Decision

The tree divides by who can use the code, not by language:

- `packages/` holds only what the VS Code extension consumes as a submodule.
  Those paths are an integration contract and do not move.
- `apps/commits/` holds the standalone application: `host` (native process),
  `bones-adapter` (WebAssembly guest, formerly `core/`), `web` (page), and its
  build scripts.
- `crates/` holds Rust libraries that do not know which application uses them.
- `ipc/` holds the wire contract with both language bindings and their shared
  fixtures.
- `vendor/` holds unedited upstream code.

Every directory carries a README stating the rule that decides what belongs in
it, rather than a list of its contents.

## Rationale

The boundary that matters is host-independence, not file extension: a reader
deciding where new code goes needs to know whether the extension must run it.
Making that the top-level split puts the license boundary, the sharing
boundary, and the directory boundary in the same place.

`ipc/` keeps both bindings together because Rust generates the fixtures the
TypeScript tests assert against; separating them by language would delete the
only mechanism that detects wire drift. This is the one place where mixing
languages is the point rather than an accident.

## Rejected alternatives

- Split the tree by language into `rust/` and `ts/`: it separates the toolchains
  but leaves the application sitting beside the shared core, which is the
  confusion that motivated the change.
- Move the MIT snapshots into `vendor/` with other imported code: the extension
  resolves `packages/core` and `packages/webview-shell` by path, so moving them
  breaks that repository.
- Rename directories without moving them: it fixes the misleading names but
  keeps application and shared code as peers.
