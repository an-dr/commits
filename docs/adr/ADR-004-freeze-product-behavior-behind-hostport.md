# ADR-004: Freeze product behavior behind HostPort

## Problem

The same product core must eventually run in bones and in the VS Code
extension. Direct bones imports or renamed page commands would force a fork or
migration during that cut-over.

## Decision

Product behavior depends only on `HostPort`. The bones adapter owns host ABI
imports and binary web commands. Page messages keep the existing
`message-protocol` convention, `acquireVsCodeApi` remains the page boundary,
and future port work preserves command names and persisted-state keys.

## Rationale

The core can be unit-tested with a stub and later receive a VS Code adapter.
Host mechanics remain thin while behavior and protocol types stay shared.

## Rejected alternatives

- Import bones throughout the core: a VS Code build would need pervasive
  conditional code.
- Replace the page protocol with a bones-specific API: the existing web code
  could not compile unmodified against the shim.
- Rename commands during the port: this creates migration work before feature
  parity exists.
