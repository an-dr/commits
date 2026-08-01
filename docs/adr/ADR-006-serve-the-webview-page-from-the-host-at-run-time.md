# ADR-006: Serve the webview page from the host at run time

## Problem

The bundled page was generated into a TypeScript module that the component
imported, so the entire page became part of `commits.wasm`. Any change to page
markup, style or script therefore required re-componentizing the guest, which is
the slowest step in the build. Embedding also placed shared MIT product markup
inside a GPL adapter source file.

## Decision

The host owns the page file. `scripts/generate-page.mjs` writes `dist/ui/page.html`,
`scripts/dist.ps1` copies it beside the executable, and a `page` bus module in
the standalone host answers a direct `send` with the file's bytes. The component
requests the page through `HostPort.loadPageHtml()` while `CommitsCore.start()`
runs, then passes the string to the unchanged `openPanel(panel, html)` call.

## Rationale

The VS Code extension host already supplies webview markup as a string at run
time, so fetching rather than embedding makes the standalone host behave like
the extension host, and `HostPort.openPanel` keeps its exact shape. Rebuilding
the page becomes a bundle step plus a file write, with no WebAssembly work. The
existing WIT `send` import carries the request, so `vendor/bones` stays read-only
as ADR-003 requires.

The call happens in `start()` rather than at construction because
componentize-js snapshots module state with wizer at build time; a top-level
request would run during the build instead of against a live host.

## Rejected alternatives

- Open the panel with the `url` variant the wire protocol already supports: it
  avoids passing markup entirely, but the extension host has no equivalent, so
  the two hosts would deliver pages by different mechanisms.
- Keep embedding the page and add build staleness checks: page edits would still
  rebuild the component, which is the case that matters most.
- Add a filesystem capability to the guest: the component intentionally runs
  without file access, and granting it would require changing the vendored WIT
  world.
