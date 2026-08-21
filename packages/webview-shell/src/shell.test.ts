import { describe, expect, it } from "vitest";
import { buildGraphShell } from "./shell";

describe("shared MIT webview shell", () => {
  it("contains every mount point required by the unchanged graph view", () => {
    const html = buildGraphShell((message) => message);
    for (const id of [
      "view", "repoSelect", "sidebarToggleBtn", "findBtn", "commitFilter",
      "refreshBtn", "resetBtn", "pullBtn", "pushBtn", "moreBtn", "findWidget",
      "branchPanel", "repoInProgressBanner", "commitGraph", "commitTable", "footer",
      "filesPanel", "fullDiffPanel", "contextMenu", "dialogBacking", "dialog",
      "scrollShadow", "openInBtn",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("puts Open in last among the buttons, right before the app menu", () => {
    const html = buildGraphShell((message) => message);

    expect(html.indexOf('id="pushBtn"')).toBeLessThan(html.indexOf('id="openInBtn"'));
    expect(html.indexOf('id="openInBtn"')).toBeLessThan(html.indexOf('id="appMenuSlot"'));
  });

  it("escapes host-provided translations before inserting them into HTML", () => {
    expect(buildGraphShell(() => `"><script>alert('x')</script>`)).not.toContain("<script>");
  });
});
