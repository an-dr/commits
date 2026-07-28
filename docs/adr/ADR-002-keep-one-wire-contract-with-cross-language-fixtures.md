# ADR-002: Keep one wire contract with cross-language fixtures

## Problem

Rust native modules and the TypeScript guest exchange fixed-layout bones
messages. Hand-maintaining independent encoders would allow silent drift.

## Decision

Keep wire code under `proto/`. Rust's `bones-messages` implementation generates
checked-in byte fixtures; TypeScript codec tests consume those exact fixtures.
JSON page messages retain the original extension's discriminated
`{ command, ... }` shape.

## Rationale

Fixtures make compatibility inspectable and test both languages without
generating one runtime implementation from the other. The page protocol stays
source-compatible with the later `an-dr-commits` port.

## Rejected alternatives

- Duplicate constants and layouts in Rust and TypeScript without fixtures:
  compilation cannot detect wire drift.
- Use serde/JSON for native bus commands: it replaces bones' intentionally
  small, allocation-conscious core protocol.
- Generate both implementations now: the small contract does not justify a
  custom generator in the foundation phase.
