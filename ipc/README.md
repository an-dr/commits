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

The framing underneath those definitions is not ours. `Reader` and `Writer` come
from `bones-messages`, which the engine and every guest already share, so the
primitives are defined once rather than reimplemented on each side of the
submodule. What lives here is the message shapes built on them: which fields a
git run or an OS request carries, and in what order. The TypeScript `Reader` and
`Writer` in `ts/` remain a local reimplementation because bones ships no
TypeScript, and the fixtures are what hold the two in agreement.
