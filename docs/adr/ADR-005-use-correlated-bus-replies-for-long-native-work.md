# ADR-005: Use correlated bus replies for long native work

## Problem

Synchronous bones `send` executes inside the current frame phase. Git, file
pickers, prompts, and repository scans have unbounded latency and would freeze
the UI or exceed the WASM watchdog if handled inline.

## Decision

Long native work starts from a fixed-layout request topic and completes on a
result topic carrying the same request ID in both its payload and envelope
correlation. Native workers own concurrency and cancellation. Synchronous
`send` is reserved for explicitly bounded capability queries.

## Rationale

The guest remains event-driven and every handler returns quickly. Native
modules can use threads and OS cancellation without adding async or filesystem
capabilities to the WASM world. Duplicate correlation makes traces inspectable
while keeping payloads independently decodable.

## Rejected alternatives

- Run Git through synchronous `send`: a slow command stalls a frame.
- Poll results synchronously: this creates per-frame traffic and hides
  completion ordering.
- Add threads or process spawning to the guest: this breaks the sandbox and
  the shared-core boundary.
