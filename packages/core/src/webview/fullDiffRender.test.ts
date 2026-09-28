import { beforeAll, describe, expect, it } from "vitest";
import { type FullDiffData, renderFullDiff } from "./fullDiffRender";

/** Answers every string lookup with its own key, so a test can assert on it. */
const l10nStub = new Proxy({}, { get: (_target, key) => String(key) });

beforeAll(() => {
  (globalThis as Record<string, unknown>).l10n = l10nStub;
});

const oldContent = "/* note\n   more */\nlet a = 1;\n";
const newContent = "/* note\n   more */\nlet b = 2;\n";
const data: FullDiffData = {
  diff: "@@ -3 +3 @@\n-let a = 1;\n+let b = 2;\n",
  oldContent,
  newContent,
  oldExists: true,
  newExists: true
};

/** The markup inside each row's content cell, in document order. */
function cells(html: string): string[] {
  return [...html.matchAll(/<span class="diffRowContent">(.*?)<\/span><\/div>/g)].map((m) => m[1]);
}

describe("renderFullDiff highlighting", () => {
  it("colours a block comment on every row it spans in unified mode", () => {
    const rows = cells(renderFullDiff(data, { mode: "unified", compact: false, path: "a.js" }));

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^<span class="hljs-comment">\/\* note<\/span>$/);
    expect(rows[1]).toMatch(/^<span class="hljs-comment">/);
  });

  it("takes removed rows from the old side and added rows from the new one", () => {
    const html = renderFullDiff(data, { mode: "unified", compact: false, path: "a.js" });

    expect(html).toMatch(/diffRemoved[^>]*>.*<span class="hljs-keyword">let<\/span> a/);
    expect(html).toMatch(/diffAdded[^>]*>.*<span class="hljs-keyword">let<\/span> b/);
  });

  it("highlights each pane from its own side in side-by-side mode", () => {
    const html = renderFullDiff(data, { mode: "sideBySide", compact: false, path: "a.js" });
    const [left, right] = html.split('diffSbsPaneNew');

    expect(left).toContain("hljs-number\">1<");
    expect(right).toContain("hljs-number\">2<");
  });

  it("highlights raw code lines after their marker and leaves headers alone", () => {
    const raw: FullDiffData = { ...data, diff: "--- a/a.js\n+++ b/a.js\n@@ -3 +3 @@\n-let a = 1;\n+let b = 2;\n" };

    const rows = cells(renderFullDiff(raw, { mode: "raw", compact: false, path: "a.js" }));

    expect(rows[0]).toBe("--- a&#x2F;a.js");
    expect(rows[2]).toBe("@@ -3 +3 @@");
    expect(rows[3]).toMatch(/^-<span class="hljs-keyword">let<\/span>/);
    expect(rows[4]).toMatch(/^\+<span class="hljs-keyword">let<\/span>/);
  });

  it("keeps an unrecognised file as escaped plain text", () => {
    const html = renderFullDiff(
      { ...data, oldContent: "<b>\n", newContent: "<i>\n", diff: "@@ -1 +1 @@\n-<b>\n+<i>\n" },
      { mode: "unified", compact: false, path: "LICENSE" }
    );

    expect(html).not.toContain("hljs-");
    expect(cells(html)).toEqual(["&lt;b&gt;", "&lt;i&gt;"]);
  });
});
