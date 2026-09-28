import { describe, expect, it } from "vitest";
import {
  highlightLine,
  highlightLines,
  languageForPath,
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHT_LINES,
  splitHighlightedLines
} from "./syntaxHighlight";

describe("languageForPath", () => {
  it.each([
    ["src/main.rs", "rust"],
    ["a/b/app.PY", "python"],
    ["scripts/dist.ps1", "powershell"],
    ["build.bat", "dos"],
    ["web/index.tsx", "typescript"],
    ["include/vec.hpp", "cpp"],
    ["lib/io.h", "c"],
    ["Cargo.toml", "ini"],
    [".github/workflows/ci.yml", "yaml"],
    ["docs/index.md", "markdown"],
    ["Program.cs", "csharp"],
    ["App.vue", "xml"],
    ["main.go", "go"],
    ["query.sql", "sql"],
    ["run.sh", "bash"],
    ["C:\\repo\\Module.psm1", "powershell"]
  ])("reads %s as %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it.each([
    ["Dockerfile", "dockerfile"],
    ["deploy/Dockerfile.prod", "dockerfile"],
    ["api.dockerfile", "dockerfile"],
    ["Makefile", "makefile"],
    ["CMakeLists.txt", "cmake"],
    ["Gemfile", "ruby"],
    ["Jenkinsfile", "groovy"],
    ["home/.bashrc", "bash"],
    [".editorconfig", "ini"],
    [".gitmodules", "ini"]
  ])("recognises the extensionless name %s", (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it.each(["LICENSE", "notes.txt", ".gitignore", "image.png", "archive.tar.gz", "dir.d/"])(
    "leaves %s as plain text",
    (path) => {
      expect(languageForPath(path)).toBeNull();
    }
  );
});

describe("splitHighlightedLines", () => {
  it("closes and reopens spans that cross a line break", () => {
    const html = 'a<span class="c">/* one\ntwo\nthree */</span>b';

    expect(splitHighlightedLines(html)).toEqual([
      'a<span class="c">/* one</span>',
      '<span class="c">two</span>',
      '<span class="c">three */</span>b'
    ]);
  });

  it("reopens every level of nested spans", () => {
    const html = '<span class="s">x<span class="e">y\nz</span>w</span>';

    expect(splitHighlightedLines(html)).toEqual([
      '<span class="s">x<span class="e">y</span></span>',
      '<span class="s"><span class="e">z</span>w</span>'
    ]);
  });

  it("keeps empty lines as their own entries", () => {
    expect(splitHighlightedLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});

describe("highlightLines", () => {
  it("returns one escaped line per input line, colouring a block comment on each", () => {
    const lines = ["/* start", "   end */", "let x = a < b;"];

    const html = highlightLines(lines, "javascript")!;

    expect(html).toHaveLength(3);
    expect(html[0]).toMatch(/^<span class="hljs-comment">/);
    expect(html[1]).toMatch(/^<span class="hljs-comment">/);
    expect(html[2]).toContain('<span class="hljs-keyword">let</span>');
    expect(html[2]).toContain("&lt;");
    expect(html[2]).not.toContain(" < ");
  });

  it("escapes markup in the source rather than emitting it", () => {
    const [html] = highlightLines(['s = "<img src=x onerror=alert(1)>"'], "python")!;

    expect(html).not.toContain("<img");
  });

  it("returns null without a language or with nothing to highlight", () => {
    expect(highlightLines(["x"], null)).toBeNull();
    expect(highlightLines([], "rust")).toBeNull();
  });

  it("returns null past the line and size limits", () => {
    expect(highlightLines(Array(MAX_HIGHLIGHT_LINES + 1).fill("x"), "rust")).toBeNull();
    expect(highlightLines(["x".repeat(MAX_HIGHLIGHT_CHARS + 1)], "rust")).toBeNull();
  });
});

describe("highlightLine", () => {
  it("highlights a single fragment", () => {
    expect(highlightLine("fn main() {}", "rust")).toContain('<span class="hljs-keyword">fn</span>');
  });

  it("returns null without a language", () => {
    expect(highlightLine("fn main() {}", null)).toBeNull();
  });
});
