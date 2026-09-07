import { describe, expect, it } from "vitest";
import { buildGraphShell } from "./shell";

describe("shared MIT webview shell", () => {
  it("contains every mount point required by the unchanged graph view", () => {
    const html = buildGraphShell((message) => message);
    for (const id of [
      "view", "repoSelect", "sidebarToggleBtn", "findBtn", "commitFilter",
      "refreshBtn", "resetBtn", "pullBtn", "pushBtn", "moreBtn", "findWidget",
      "branchPanel", "repoInProgressBanner", "submoduleBanner", "commitGraph", "commitTable", "footer",
      "filesPanel", "fullDiffPanel", "contextMenu", "dialogBacking", "dialog",
      "scrollShadow", "openInBtn", "filesPanelToggleBtn",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("leads the left group with the branch toggle, then the repo and Open in", () => {
    const html = buildGraphShell((message) => message);

    expect(html.indexOf('id="sidebarToggleBtn"')).toBeLessThan(html.indexOf('id="repoSelect"'));
    expect(html.indexOf('id="repoSelect"')).toBeLessThan(html.indexOf('id="openInBtn"'));
    expect(html.indexOf('id="openInBtn"')).toBeLessThan(html.indexOf('id="commitFilter"'));
  });

  it("puts the files panel toggle last of all, after the app and more menus", () => {
    const html = buildGraphShell((message) => message);

    expect(html.indexOf('id="appMenuSlot"')).toBeLessThan(html.indexOf('id="filesPanelToggleBtn"'));
    expect(html.indexOf('id="moreBtn"')).toBeLessThan(html.indexOf('id="filesPanelToggleBtn"'));
  });

  it("escapes host-provided translations before inserting them into HTML", () => {
    expect(buildGraphShell(() => `"><script>alert('x')</script>`)).not.toContain("<script>");
  });
});
