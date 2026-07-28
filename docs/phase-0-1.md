# Phase 0–1 walking skeleton

## Implemented

- Rust workspace with a bones composition root and `git`, `watcher`, and `os`
  native module boundaries.
- wry-enabled desktop host loading extensions beside the executable.
- TypeScript-to-component build for `hello.wasm` and `commits.wasm`.
- Fixed-layout TypeScript `Reader`/`Writer` and web protocol messages, verified
  against fixtures emitted by the Rust bones message implementation.
- Host-agnostic `CommitsCore` behind `HostPort`; only the bones adapter imports
  `bones:core/host-api`.
- Browser `acquireVsCodeApi` compatibility shim translating bones
  `CustomEvent` messages into the original extension's `message` event shape.
- Typed `{ command, ... }` echo request/response visible in the page.

## Verification

Measured on Windows 11 ARM64 on 2026-07-28, using the default StarlingMonkey
componentization backend with all unused WASI features disabled:

| Check | Result |
| --- | ---: |
| `commits.wasm` size | 11,660,757 bytes |
| Uncached component load + `init` | 16,395 ms |
| Mean small echo handler call, 1,000 calls | 282 µs |
| One 1 MiB JSON echo | 52.528 ms; watchdog fault |

`cargo test -p commits-app --test component_load -- --nocapture` loads both
components through bones. It records the hello guest log and confirms the
commits component initializes and requests its panel.

The 1 MiB result activates the native hot-parsing fallback in ADR-001.
Component handlers stay bounded; large Git output must not cross the guest as
one synchronous parse operation.

## Run

```powershell
npm run dist
.\dist\app\commits.exe
```

Closing the native window runs bones' orderly shutdown sequence, which calls
the component shutdown hooks and closes owned panels.
