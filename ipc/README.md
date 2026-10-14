# Wire contract

This directory defines message formats crossing a process or component boundary: Bones web-panel messages and the app's native service requests and results.

Both language bindings live together. Rust generates the byte fixtures in `fixtures/`, TypeScript asserts against those bytes, and changes that break one side fail the other's tests. Types used on only one side stay with that side's code.

Rust's framing primitives come from `bones-messages`. The TypeScript codec remains local because Bones ships no TypeScript; conformance fixtures hold it to the same framing.

## Launch requests

The `launch` endpoint and `launch/request` topic use the same encoding: a little-endian u32 `sequence`, then a length-prefixed u32 UTF-8 JSON blob. The JSON is `LaunchContent` in `rust/src/native.rs`, mirrored by `LaunchRequest` in `ts/native.ts`: `kind` (`none`, `repository`, or `rejected`), `paths` or `reason` as appropriate, and validated navigation and appearance options. `sequence` starts at zero and increases on handoff. Shared `launch_startup` and `launch_handoff` fixtures exercise both language bindings.

`repository-state` answers JSON facts about one repository path for the health reader, and `sources` answers JSON repository lists. Neither endpoint accepts writes. See the [command-line contract](../docs/command-line.md) for user-facing launch semantics.

## Bones-owned services

Update and desktop requests use the `bones-messages::upgrader` and `bones-messages::desktop` vocabularies. They carry a caller's u32 request id and a one-byte action; release URLs are fixed by native composition. `encodeUpgraderRequest` and `encodeDesktopRequest` build the requests, and the result decoders map Bones' outcomes onto the app menu's status model. Fixtures generated from `bones-messages` pin both directions, so a renumbered action in Bones fails the TypeScript tests.
