# Syntax highlighting

The full-diff panel colours source code by language in all three of its
modes. The rest of the page — commit messages, file lists, the graph — stays
plain text.

## Engine

Highlighting uses [highlight.js](https://highlightjs.org/) 11 (BSD-3-Clause),
bundled into the page, so it works offline and never fetches a grammar at run
time. Only the grammars listed below are registered; the full set of about 190
would roughly quadruple the page script for languages few repositories hold.

It is synchronous. Shiki's TextMate grammars are more exact but load
asynchronously through a WebAssembly regex engine several megabytes in size,
which the panel's render-on-select model does not accommodate.

## Choosing the language

The language comes from the file's path alone; content is never inspected,
because automatic detection is slow and guesses wrong on short files. The
lookup runs in this order, case-insensitively:

1. The whole file name, for files that have no telling extension:
   `Dockerfile`, `Containerfile`, `Makefile`, `GNUmakefile`, `CMakeLists.txt`,
   `Gemfile`, `Rakefile`, `Podfile`, `Vagrantfile`, `Jenkinsfile`, and shell
   start-up files such as `.bashrc`, `.zshrc` and `.profile`, and the INI-style
   `.editorconfig`, `.gitconfig` and `.gitmodules`. A name that begins
   `Dockerfile.` or ends `.dockerfile` is a Dockerfile.
2. The last extension, from the table below.

Anything else is shown as plain text.

## Languages

| Language | Extensions |
| --- | --- |
| Ada | `adb` `ads` |
| AppleScript | `applescript` `scpt` |
| AutoHotkey | `ahk` |
| Awk | `awk` |
| Bash / shell | `sh` `bash` `zsh` `ksh` `fish` |
| Batch | `bat` `cmd` |
| C | `c` `h` |
| C# | `cs` `csx` |
| C++ | `cpp` `cc` `cxx` `c++` `hpp` `hh` `hxx` `h++` `ino` `ipp` `tpp` |
| Clojure | `clj` `cljs` `cljc` `edn` |
| CMake | `cmake` |
| CoffeeScript | `coffee` |
| Crystal | `cr` |
| CSS | `css` |
| D | `d` |
| Dart | `dart` |
| Delphi / Pascal | `pas` `dpr` `pp` `lpr` |
| Diff | `diff` `patch` |
| Dockerfile | `dockerfile` |
| Elixir | `ex` `exs` |
| Elm | `elm` |
| Erlang | `erl` `hrl` |
| F# | `fs` `fsi` `fsx` |
| Fortran | `f` `for` `f90` `f95` `f03` `f08` |
| GLSL | `glsl` `vert` `frag` `geom` `comp` |
| Go | `go` |
| Gradle | `gradle` |
| GraphQL | `graphql` `gql` |
| Groovy | `groovy` `gvy` |
| Handlebars | `hbs` `handlebars` `mustache` |
| Haskell | `hs` `lhs` |
| HTML / XML | `html` `htm` `xhtml` `xml` `svg` `xsd` `xsl` `xslt` `plist` `csproj` `vbproj` `fsproj` `vcxproj` `props` `targets` `resx` `xaml` `vue` `svelte` |
| INI / TOML | `ini` `cfg` `conf` `toml` |
| Java | `java` `jsp` |
| JavaScript | `js` `jsx` `mjs` `cjs` |
| JSON | `json` `jsonc` `json5` `webmanifest` |
| Julia | `jl` |
| Kotlin | `kt` `kts` |
| LaTeX | `tex` `sty` `cls` `bib` |
| Less | `less` |
| Lisp | `lisp` `lsp` `el` |
| Lua | `lua` |
| Makefile | `mk` `mak` `make` |
| Markdown | `md` `markdown` `mdx` |
| Nginx | `nginx` |
| Nim | `nim` `nims` |
| Nix | `nix` |
| Objective-C | `m` `mm` |
| OCaml | `ml` `mli` |
| Perl | `pl` `pm` `t` |
| PHP | `php` `phtml` |
| PowerShell | `ps1` `psm1` `psd1` |
| Properties | `properties` |
| Protocol Buffers | `proto` |
| Python | `py` `pyw` `pyi` `gyp` |
| R | `r` |
| Ruby | `rb` `rake` `gemspec` `ru` `erb` |
| Rust | `rs` |
| Scala | `scala` `sc` `sbt` |
| Scheme | `scm` `ss` `rkt` |
| SCSS | `scss` `sass` |
| SQL | `sql` |
| Swift | `swift` |
| Tcl | `tcl` |
| TypeScript | `ts` `tsx` `mts` `cts` |
| VB.NET | `vb` |
| VBScript | `vbs` |
| Verilog | `v` `sv` `svh` |
| VHDL | `vhd` `vhdl` |
| Vim script | `vim` |
| WebAssembly text | `wat` `wast` |
| x86 assembly | `asm` `nasm` |
| YAML | `yaml` `yml` |

Some rows are approximations where no closer grammar is bundled: TOML is read
as INI, Vue and Svelte single-file components as HTML, and `.erb` templates as
Ruby. `.m` is read as Objective-C, the more common `.m` file in a Git repository,
so MATLAB sources are not recognised.

## Per mode

**Unified and side-by-side** highlight the whole old file and the whole new
file once each, then split the result into lines. Every row takes its line
from the side it belongs to — removed rows from the old file, added and
context rows from the new one — so a construct spanning several lines, such
as a block comment or a multi-line string, is coloured correctly throughout.

**Raw** is Git's own output, which holds only fragments of the file, so each
added, removed or context line is highlighted on its own after its `+`, `-`
or space marker. A construct that spans lines can lose its colour in this
mode only. Hunk and file headers keep their existing styling.

## Limits

A side larger than 1 MB or 20,000 lines is shown as plain text. Highlighting
cost grows with the input, and past that size the panel would stall on
opening a file. Each side is judged on its own, so a small edit to a huge file
still shows plain text only for that file.

## Colours

The highlighter emits `hljs-*` classes. The shared stylesheet maps them to
`--syntax-*` custom properties, listed in the
[theme contract](../packages/core/src/webview/THEME.md), with a light and a
dark fallback for a host that does not define them. The standalone app sets
them from each theme preset in `apps/commits/web/src/themes.ts`, so every
preset has its own palette.
