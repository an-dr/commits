# Rust libraries

Rust crates that provide a capability without knowing which application uses it.

A crate belongs here when it could serve another host unchanged: it exposes a
capability through the Bones module and bus interfaces and never assumes this
application's window, layout, or lifecycle. Code that only makes sense for the
standalone client belongs in `apps/commits/host`.

Native work stays deliberately mechanical here. Decisions about what to request
and how to interpret results live in the core, not in these crates.
