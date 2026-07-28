# ADR-003: Treat vendored bones as read-only upstream

## Problem

Product needs can tempt local changes to the engine or WIT world. Such changes
would make the app depend on an unshareable bones fork.

## Decision

Keep `vendor/bones` read-only apart from deliberate submodule pin updates.
Product capabilities are injected native modules and existing web protocol
messages. Engine changes are contributed upstream first.

## Rationale

Bones already exposes module injection, web panels, persistence, and the
extension world required by the app. A clean submodule boundary keeps upgrades
reviewable and makes product ownership explicit.

## Rejected alternatives

- Add product calls to `core.wit`: Git, watcher, and OS surfaces are native
  modules reachable over the bus.
- Carry local vendor patches: every bones update would require a private
  rebase and obscure the actual product diff.
