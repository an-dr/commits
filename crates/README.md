# Rust libraries

Native modules this application needs and the engine does not provide.

The rule that decides what belongs here is the opposite of what it used to be. A crate that could serve another host unchanged does not belong here at all: it belongs in `bones`, where every host gets it. What is left in this directory is what only a git client could want -- spawning `git`, watching a repository's files, and the OS actions that need a repository to mean anything.

Anything genuinely generic is upstream. Clipboard, browser, file pickers and HTTPS fetch are the engine's `os` module; self-update is `bones-upgrader`; the wire codec is `bones-messages`. When something here turns out to be reusable, the move is a contribution to bones and a submodule bump, never a copy (ADR-003).

Code that only makes sense for the standalone client -- its window, layout or lifecycle -- belongs in `apps/commits/host` instead.

Processes spawned here run without a console, because the host is a windowed application with none to inherit and Windows would otherwise give every child its own window.

Native work stays deliberately mechanical here. Decisions about what to request and how to interpret results live in the core, not in these crates.
