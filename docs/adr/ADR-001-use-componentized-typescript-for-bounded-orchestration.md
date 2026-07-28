# ADR-001: Use componentized TypeScript for bounded orchestration

## Problem

The port needs TypeScript product logic inside a bones WebAssembly component,
but an embedded JavaScript engine adds binary, startup, and handler costs. The
bones watchdog faults any handler exceeding 50 ms.

## Decision

Use `jco componentize` with StarlingMonkey for bounded orchestration and page
protocol handlers. Disable every unused WASI feature. Do not parse large Git
output synchronously in the component: Phase 2 exposes hot parsing through a
native protocol boundary unless later AOT/cache measurements meet the budget.

## Rationale

The Phase 0 probe is 11,660,757 bytes and handles small echo messages in
282 µs, but uncached initialization takes 16.4 seconds. A single 1 MiB JSON
echo takes 52.528 ms and triggers the watchdog. The component is
viable for short control flow, not the planned hot parsing path as measured.

## Rejected alternatives

- Keep large parsing in TypeScript and raise the watchdog: one extension would
  be allowed to stall a frame, weakening a system-wide safety boundary.
- Abandon the TypeScript component entirely: this prevents sharing the
  host-agnostic product core with the VS Code extension.
- Use QuickJS-NG now: `componentize-qjs` 0.3 and 0.4 fail during WIT linking on
  Windows ARM64 before application code runs.
