# Wire contract

The message formats crossing a process or component boundary: the binary Bones
web-panel protocol and the native service requests and results.

Both language bindings live here together because neither is the source of
truth. Rust generates the byte fixtures in `fixtures/`, TypeScript tests assert
against those same bytes, and a change that breaks one side fails the other's
tests. Splitting the bindings apart would remove the only mechanism that detects
drift.

A definition belongs here when both sides of a boundary must agree on its exact
bytes. Types used on only one side belong with that side's code.
