# ADR-012: Generic capabilities belong upstream, not in this repository

## Problem

[ADR-003](ADR-003-treat-vendored-bones-as-read-only-upstream.md) settled that engine changes are contributed upstream rather than patched locally. It did not say which capabilities are engine changes, so anything a native module could implement was written here by default, whether or not it had anything to do with git.

Four things had accumulated that way: a wire codec, self-update, the desktop OS surface, and a page server. Each was written against a real need, and none of them knew what a repository was. `crates/README.md` even stated the test out loud -- a crate belongs there when "it could serve another host unchanged" -- while the directory it described was where such crates stayed.

The cost is not duplication in the abstract. `bones-messages` already shipped a `Reader` and `Writer` producing byte-identical output to this repository's, and neither side knew, so the two could have drifted into a protocol bug that no compiler on either side would catch.

## Decision

A capability that does not need a repository belongs in bones, and reaches this application through the submodule pin.

Moved: the wire codec (now `bones-messages::codec`, whose fallible `try_str`/`try_blob` this repository contributed), self-update (`bones-upgrader`), and the desktop OS surface -- clipboard, browser, file pickers, HTTPS fetch (`bones-module-os`, with its messages in `bones-messages::os`).

Kept: spawning `git`, watching a repository's files, and the OS actions that need a repository -- a file read confined to one, a scan for them, an external tool launched against one. These are a `repo-os` endpoint of our own, numbered independently of the engine's.

The move is always a contribution to bones then a pin bump, never a copy. A capability that exists in both places is the failure this decision exists to prevent.

## Rationale

The test is "does this need a repository", not "is this reusable in principle". Reusability is a judgement that drifts; needing a repository is a fact about the code, and it is what separates a git client from a desktop application. It also answers the awkward cases directly: `fetch_url` fetches any URL and goes upstream, while `read_file` resolves a path inside a repository and stays.

Splitting the OS surface required renumbering its actions. The generic and git-aware ones had interleaved in one contiguous byte space, so neither half could move without leaving gaps the other had to honour forever. Two endpoints each numbering from zero costs one wire change now instead of a permanent deformity in both. Both sides moved together, so no observable behaviour changed even though the bytes did.

What stays behind is a stronger argument for the boundary than what moved. `crates/os` lost `arboard`, `rfd`, `open` and an entire TLS stack, because none of them were ever about git.

## Rejected alternatives

- **Keep the numbering and split only the trait.** No wire change, but upstream would ship an action space with holes in it, and every later consumer would inherit gaps that exist for reasons specific to this repository.
- **Move the page server too.** It looked generic, and is not: `PanelSource::Html` is served by a handler on the window-owning thread, which is exactly the thread busy loading the component while the splash needs painting. The local server has its own thread, which is the whole reason it exists. Making that handler answer off the window thread would retire it, and is an engine change for its own branch.
- **Move the TypeScript codec bindings as well.** bones has no TypeScript at all -- no package.json, no test runner -- and there is no second consumer yet. The Rust codec moved; the TypeScript stays until the VS Code extension exists, with the cross-language fixtures still holding the two in agreement.
- **Wait for a second consumer before moving anything.** This is the ordinary argument against premature generalisation, and it does not apply to code that is already written, already generic, and already duplicated upstream without either side knowing.
