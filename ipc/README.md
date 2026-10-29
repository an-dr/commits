# Wire contract

This directory defines message formats crossing a process or component boundary: bones web-panel messages and the app's native service requests and results.

Both language bindings live together. Rust generates the byte fixtures in `fixtures/`, TypeScript asserts against those bytes, and changes that break one side fail the other's tests. Types used on only one side stay with that side's code.

Rust's framing primitives come from `bones-messages`. The TypeScript codec remains local because bones ships no TypeScript package. Two sets of fixtures hold it to the same framing: this directory's own for the app's endpoints, and bones' conformance vectors (`vendor/bones/wit/vectors/vectors.txt`) for every `web`, `desktop`, `os`, and `upgrader` message, checked by `ts/bones-vectors.test.ts`. A vector bones adds for one of those surfaces fails that test until it is checked or recorded as one Commits never sends.

The codec's tag numbers and the shapes of those messages come from `ts/bones-messages.ts`, generated from bones' wire format specification (`vendor/bones/wit/wire-format.json`) by `cargo xtask wire-types`. Regenerate it after updating bones; `cargo xtask test` fails while the committed file is stale, and a renumbered action or a renamed field then shows up as a type error in the codec.

## Launch requests

The `launch` endpoint and `launch/request` topic use the same encoding: a little-endian u32 `sequence`, then a length-prefixed u32 UTF-8 JSON blob. The JSON is `LaunchContent` in `rust/src/native.rs`, mirrored by `LaunchRequest` in `ts/native.ts`: `kind` (`none`, `repository`, or `rejected`), `paths` or `reason` as appropriate, and validated navigation and appearance options. `sequence` starts at zero and increases on handoff. Shared `launch_startup` and `launch_handoff` fixtures exercise both language bindings.

`repository-state` answers JSON facts about one repository path for the health reader, and `sources` answers JSON repository lists. Neither endpoint accepts writes. See the [command-line contract](../docs/command-line.md) for user-facing launch semantics.

## bones-owned services

Update and desktop requests use the `bones-messages::upgrader` and `bones-messages::desktop` vocabularies. They carry a caller's u32 request id and a one-byte action; release URLs are fixed by native composition. `encodeUpgraderRequest` and `encodeDesktopRequest` build the requests, and the result decoders map bones' outcomes onto the app menu's status model. Fixtures generated from `bones-messages` pin both directions, so a renumbered action in bones fails the TypeScript tests.
