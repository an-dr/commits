# Rust binding

The Rust side of the wire contract, and the generator that makes the shared
fixtures.

This binding is the oracle: `generate-fixtures` writes the byte fixtures, and
both languages' tests assert against them. When a message layout changes, change
it here first and regenerate, so the TypeScript tests fail until that side
follows.
