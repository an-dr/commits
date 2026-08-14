# Third-party notices

## This repository

Everything in this repository is MIT-licensed under the root `LICENSE`,
including the vendored `bones` engine, which carries its own identical MIT
grant. ADR-011 records why the root moved from GPL-3.0 to MIT.

The imported packages keep their own `LICENSE` and `NOTICE.md` because their
upstream attribution survives that change; the grant is the same one the root
now uses.

## Imported product code

The repository includes a snapshot of `@an-dr/commits-core` under
`packages/core` and reusable webview assets under `packages/webview-shell`.
Files under `packages/core/src/webview` carry local modifications, which
`docs/shared-core.md` describes; everything else is unmodified.
They were copied or adapted from `an-dr-com-mit-s` at commit
`69271fe1462d5532f0a56b2872770121f6a4dbfd`. Its MIT license and upstream
notice are preserved in each package's `LICENSE` and `NOTICE.md`.

That MIT implementation is derived from `asispts/neo-git-graph` commit
`437ee6c479bda3a0861c8e657bd99895907623f5`, retrieved on 2026-07-28. Its
notice states that it does not incorporate code from post-MIT Git Graph
releases.

The separately archived `vscode-git-graph` license is not the standard MIT
license and is not the source of the imported package. It remains in
`licenses/vscode-git-graph-LICENSE` as a record of the abandoned migration
path.

## Dependencies carrying their own terms

Most dependencies are MIT, Apache-2.0, ISC, BSD or Zlib and need no note. These
do.

`cssparser`, `cssparser-macros`, `dtoa-short`, `selectors` and `option-ext` are
MPL-2.0, as is the build-time `lightningcss`. MPL-2.0 is file-level copyleft: it
binds those files, not the work that links them, and this repository does not
modify them. Anyone redistributing a build containing them must be able to
supply their source under MPL-2.0.

`ittapi` and `ittapi-sys` are `GPL-2.0-only OR BSD-3-Clause`, and `r-efi` is
`MIT OR Apache-2.0 OR LGPL-2.1-or-later`. Where a dependency offers a choice,
this repository elects the permissive option -- BSD-3-Clause and MIT
respectively -- and never the copyleft one.

`commits.wasm` embeds a JavaScript engine through
`@bytecodealliance/componentize-js`, which builds on StarlingMonkey and
SpiderMonkey. Those carry Apache-2.0 with the LLVM exception and MPL-2.0
respectively, and the MPL-2.0 obligation above applies to the engine sources
compiled into that component.
