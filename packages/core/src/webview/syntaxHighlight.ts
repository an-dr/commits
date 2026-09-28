import hljs from "highlight.js/lib/core";
import ada from "highlight.js/lib/languages/ada";
import applescript from "highlight.js/lib/languages/applescript";
import autohotkey from "highlight.js/lib/languages/autohotkey";
import awk from "highlight.js/lib/languages/awk";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import clojure from "highlight.js/lib/languages/clojure";
import cmake from "highlight.js/lib/languages/cmake";
import coffeescript from "highlight.js/lib/languages/coffeescript";
import cpp from "highlight.js/lib/languages/cpp";
import crystal from "highlight.js/lib/languages/crystal";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import d from "highlight.js/lib/languages/d";
import dart from "highlight.js/lib/languages/dart";
import delphi from "highlight.js/lib/languages/delphi";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import elixir from "highlight.js/lib/languages/elixir";
import elm from "highlight.js/lib/languages/elm";
import erlang from "highlight.js/lib/languages/erlang";
import fortran from "highlight.js/lib/languages/fortran";
import fsharp from "highlight.js/lib/languages/fsharp";
import glsl from "highlight.js/lib/languages/glsl";
import go from "highlight.js/lib/languages/go";
import gradle from "highlight.js/lib/languages/gradle";
import graphql from "highlight.js/lib/languages/graphql";
import groovy from "highlight.js/lib/languages/groovy";
import handlebars from "highlight.js/lib/languages/handlebars";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import julia from "highlight.js/lib/languages/julia";
import kotlin from "highlight.js/lib/languages/kotlin";
import latex from "highlight.js/lib/languages/latex";
import less from "highlight.js/lib/languages/less";
import lisp from "highlight.js/lib/languages/lisp";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import nim from "highlight.js/lib/languages/nim";
import nix from "highlight.js/lib/languages/nix";
import objectivec from "highlight.js/lib/languages/objectivec";
import ocaml from "highlight.js/lib/languages/ocaml";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scheme from "highlight.js/lib/languages/scheme";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import tcl from "highlight.js/lib/languages/tcl";
import typescript from "highlight.js/lib/languages/typescript";
import vbnet from "highlight.js/lib/languages/vbnet";
import vbscript from "highlight.js/lib/languages/vbscript";
import verilog from "highlight.js/lib/languages/verilog";
import vhdl from "highlight.js/lib/languages/vhdl";
import vim from "highlight.js/lib/languages/vim";
import wasm from "highlight.js/lib/languages/wasm";
import x86asm from "highlight.js/lib/languages/x86asm";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Only these grammars are bundled; docs/syntax-highlighting.md explains the
 * choice and lists which file names reach each one.
 */
const GRAMMARS = {
  ada, applescript, autohotkey, awk, bash, c, clojure, cmake, coffeescript, cpp,
  crystal, csharp, css, d, dart, delphi, diff, dockerfile, dos, elixir, elm,
  erlang, fortran, fsharp, glsl, go, gradle, graphql, groovy, handlebars,
  haskell, ini, java, javascript, json, julia, kotlin, latex, less, lisp, lua,
  makefile, markdown, nginx, nim, nix, objectivec, ocaml, perl, php, powershell,
  properties, protobuf, python, r, ruby, rust, scala, scheme, scss, sql, swift,
  tcl, typescript, vbnet, vbscript, verilog, vhdl, vim, wasm, x86asm, xml, yaml
};

export type SyntaxLanguage = keyof typeof GRAMMARS;

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

/**
 * Extensions per grammar. Kept explicit rather than deferring to highlight.js
 * aliases, several of which ("do", "re", "st", "as") name unrelated file types.
 */
const EXTENSIONS: { readonly [L in SyntaxLanguage]?: readonly string[] } = {
  ada: ["adb", "ads"],
  applescript: ["applescript", "scpt"],
  autohotkey: ["ahk"],
  awk: ["awk"],
  bash: ["sh", "bash", "zsh", "ksh", "fish"],
  c: ["c", "h"],
  clojure: ["clj", "cljs", "cljc", "edn"],
  cmake: ["cmake"],
  coffeescript: ["coffee"],
  cpp: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ino", "ipp", "tpp"],
  crystal: ["cr"],
  csharp: ["cs", "csx"],
  css: ["css"],
  d: ["d"],
  dart: ["dart"],
  delphi: ["pas", "dpr", "pp", "lpr"],
  diff: ["diff", "patch"],
  dockerfile: ["dockerfile"],
  dos: ["bat", "cmd"],
  elixir: ["ex", "exs"],
  elm: ["elm"],
  erlang: ["erl", "hrl"],
  fortran: ["f", "for", "f90", "f95", "f03", "f08"],
  fsharp: ["fs", "fsi", "fsx"],
  glsl: ["glsl", "vert", "frag", "geom", "comp"],
  go: ["go"],
  gradle: ["gradle"],
  graphql: ["graphql", "gql"],
  groovy: ["groovy", "gvy"],
  handlebars: ["hbs", "handlebars", "mustache"],
  haskell: ["hs", "lhs"],
  ini: ["ini", "cfg", "conf", "toml"],
  java: ["java", "jsp"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  json: ["json", "jsonc", "json5", "webmanifest"],
  julia: ["jl"],
  kotlin: ["kt", "kts"],
  latex: ["tex", "sty", "cls", "bib"],
  less: ["less"],
  lisp: ["lisp", "lsp", "el"],
  lua: ["lua"],
  makefile: ["mk", "mak", "make"],
  markdown: ["md", "markdown", "mdx"],
  nginx: ["nginx"],
  nim: ["nim", "nims"],
  nix: ["nix"],
  objectivec: ["m", "mm"],
  ocaml: ["ml", "mli"],
  perl: ["pl", "pm", "t"],
  php: ["php", "phtml"],
  powershell: ["ps1", "psm1", "psd1"],
  properties: ["properties"],
  protobuf: ["proto"],
  python: ["py", "pyw", "pyi", "gyp"],
  r: ["r"],
  ruby: ["rb", "rake", "gemspec", "ru", "erb"],
  rust: ["rs"],
  scala: ["scala", "sc", "sbt"],
  scheme: ["scm", "ss", "rkt"],
  scss: ["scss", "sass"],
  sql: ["sql"],
  swift: ["swift"],
  tcl: ["tcl"],
  typescript: ["ts", "tsx", "mts", "cts"],
  vbnet: ["vb"],
  vbscript: ["vbs"],
  verilog: ["v", "sv", "svh"],
  vhdl: ["vhd", "vhdl"],
  vim: ["vim"],
  wasm: ["wat", "wast"],
  x86asm: ["asm", "nasm"],
  xml: [
    "html", "htm", "xhtml", "xml", "svg", "xsd", "xsl", "xslt", "plist", "csproj",
    "vbproj", "fsproj", "vcxproj", "props", "targets", "resx", "xaml", "vue", "svelte"
  ],
  yaml: ["yaml", "yml"]
};

/** Whole file names that carry no telling extension. */
const FILE_NAMES: { readonly [name: string]: SyntaxLanguage } = {
  "dockerfile": "dockerfile",
  "containerfile": "dockerfile",
  "makefile": "makefile",
  "gnumakefile": "makefile",
  "cmakelists.txt": "cmake",
  "gemfile": "ruby",
  "rakefile": "ruby",
  "podfile": "ruby",
  "vagrantfile": "ruby",
  "jenkinsfile": "groovy",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".bash_aliases": "bash",
  ".zshrc": "bash",
  ".zprofile": "bash",
  ".profile": "bash",
  ".editorconfig": "ini",
  ".gitconfig": "ini",
  ".gitmodules": "ini"
};

const BY_EXTENSION = new Map<string, SyntaxLanguage>(
  Object.entries(EXTENSIONS).flatMap(([language, extensions]) =>
    extensions!.map((extension) => [extension, language as SyntaxLanguage] as const)
  )
);

/** Sides larger than these are shown as plain text, so opening a file never stalls. */
export const MAX_HIGHLIGHT_LINES = 20000;
export const MAX_HIGHLIGHT_CHARS = 1_000_000;

/** Picks the grammar for a path, or null when the file should stay plain text. */
export function languageForPath(path: string): SyntaxLanguage | null {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).toLowerCase();
  const byName = FILE_NAMES[name];
  if (byName !== undefined) {
    return byName;
  }
  if (name.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  const dot = name.lastIndexOf(".");
  // A leading dot marks a hidden file with no extension, not an extension.
  return dot > 0 ? BY_EXTENSION.get(name.slice(dot + 1)) ?? null : null;
}

const SPAN_OR_NEWLINE = /<span[^>]*>|<\/span>|\n/g;

/**
 * Splits highlighted markup into lines that are each well-formed on their
 * own: a span still open at a line break is closed there and reopened on the
 * next line, so a block comment keeps its colour on every row it covers.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = "";
  let last = 0;
  for (const match of html.matchAll(SPAN_OR_NEWLINE)) {
    line += html.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[0] === "\n") {
      lines.push(line + "</span>".repeat(open.length));
      line = open.join("");
    } else {
      if (match[0] === "</span>") {
        open.pop();
      } else {
        open.push(match[0]);
      }
      line += match[0];
    }
  }
  lines.push(line + html.slice(last));
  return lines;
}

/**
 * Highlights a whole side of a file as one text, returning escaped markup per
 * line, or null when the side should be shown plain — no language, or too
 * large to highlight without stalling the panel.
 */
export function highlightLines(
  lines: readonly string[],
  language: SyntaxLanguage | null
): string[] | null {
  if (language === null || lines.length === 0 || lines.length > MAX_HIGHLIGHT_LINES) {
    return null;
  }
  const text = lines.join("\n");
  if (text.length > MAX_HIGHLIGHT_CHARS) {
    return null;
  }
  const highlighted = splitHighlightedLines(hljs.highlight(text, { language, ignoreIllegals: true }).value);
  // The rows index into this array by line number, so a mismatch would shift
  // every colour onto the wrong line; plain text is the safer answer.
  return highlighted.length === lines.length ? highlighted : null;
}

/**
 * Highlights one line on its own, for text that holds only fragments of a
 * file. Returns null when there is no language, so the caller escapes instead.
 */
export function highlightLine(line: string, language: SyntaxLanguage | null): string | null {
  if (language === null || line.length > MAX_HIGHLIGHT_CHARS) {
    return null;
  }
  return hljs.highlight(line, { language, ignoreIllegals: true }).value;
}
