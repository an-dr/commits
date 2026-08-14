# ADR-011: Relicense the repository to MIT

## Problem

The root carried GPL-3.0 from the initial commit, and the documentation explained it as an obligation: the README described a "GPL-licensed Bones host", `apps/commits/README.md` declared "everything here is GPL-3.0", and `packages/README.md` treated the directory split as the line between MIT product code and a copyleft application. That reading made the license boundary and the sharing boundary the same line, so every question about sharing code with the VS Code extension arrived as a licensing question first.

None of it was true. `vendor/bones` is MIT, copyright Andrei Gramakov, so the engine never imposed copyleft, and a dependency sweep across all 548 resolved crates and the npm tree found nothing that could. The GPL was a choice made once and then reasoned about as if it were a constraint.

Two further effects made this worth settling rather than leaving. None of the six local crates declared a license at all, so the actual grant over the Rust code was ambiguous whatever the root file said. And placing the extension host in this repository — the open question that surfaced this one — would have required a per-directory license map to keep that host MIT.

## Decision

The repository is MIT throughout, copyright 2026 Andrei Gramakov, using the same text as `vendor/bones`. The six local crates and the root `package.json` declare `MIT` explicitly.

`packages/` stops being a license boundary and remains a host-independence boundary, which is what ADR-007 argued it was really about. The imported packages keep their own `LICENSE` and `NOTICE.md` files, because upstream attribution survives a relicense of the surrounding work; nothing under `packages/core` or `packages/webview-shell` changes.

Three dependency facts are recorded in `THIRD_PARTY_NOTICES.md` rather than left implicit: the MPL-2.0 components whose weak file-level copyleft binds those files only, the dual-licensed crates where this repository elects the permissive option, and the JavaScript engine embedded in `commits.wasm`.

## Rationale

Relicensing is only possible while one copyright holder owns the whole work, and that is true today: this repository and `vendor/bones` share an author, and the imported MIT packages already permit it. That window closes the moment an outside contribution lands, so making the choice deliberately now costs nothing and later costs consent from everyone who contributed.

MIT also matches what the code is for. The stated goal is one core serving two hosts, one of which is a VS Code extension published to a marketplace; a permissive license removes the friction from that path instead of adding a per-directory map to work around it.

The non-free `vscode-git-graph` license archived under `licenses/` is unaffected. `THIRD_PARTY_NOTICES.md` records that it is not the source of the imported package, and that reasoning has to hold on its own terms: it forbids redistributing derivative works outright, so copyleft would not have rescued the lineage if it applied.

Builds already distributed under GPL-3.0 stay licensed that way for whoever received them. Relicensing is not retroactive, and it does not need to be.

## Rejected alternatives

- Keep GPL-3.0 at the root and add an explicit MIT carve-out for an extension host directory: it preserves a boundary that no dependency requires, and every new directory then has to be placed on one side of a map that exists for no reason.
- Dual-license the repository: two grants to reason about, with no consumer needing the second.
- Leave the license alone and place the extension in its own repository: it does not remove the false premise, and it keeps paying the divergence cost that `docs/shared-core.md` already records against `packages/core`.
