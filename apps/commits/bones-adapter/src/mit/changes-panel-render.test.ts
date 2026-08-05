import { beforeAll, describe, expect, it } from "vitest";
import { createLocalizedStrings } from "@an-dr/commits-webview-shell/l10n";
import type { GitWorkingTreeChange } from "@an-dr/commits-core/data-source/models";
import { renderChangesPanel } from "@an-dr/commits-core/webview/changesPanelRender";

/** The panel reads strings and file icons from the page globals. */
beforeAll(() => {
  globalThis.l10n = createLocalizedStrings((text) => text);
  globalThis.viewState = { fileIcons: {} } as typeof globalThis.viewState;
});

describe("renderChangesPanel", () => {
  it("separates what is staged from what is not", () => {
    const html = renderChangesPanel(
      [change({ path: "src/a.ts", staged: true }), change({ path: "src/b.ts", staged: false })],
      null
    );

    expect(html).toContain("Staged Changes");
    expect(html).toContain("Changes");
    expect(html.indexOf("Staged Changes")).toBeLessThan(html.indexOf("src&#x2F;b.ts"));
    expect(html).toContain('data-staged="true"');
    expect(html).toContain('data-staged="false"');
  });

  it("counts the files in each section", () => {
    const html = renderChangesPanel(
      [
        change({ path: "one.ts", staged: true }),
        change({ path: "two.ts", staged: true }),
        change({ path: "three.ts", staged: false }),
      ],
      null
    );

    expect(html).toContain('<span class="changesSectionCount">2</span>');
    expect(html).toContain('<span class="changesSectionCount">1</span>');
  });

  it("shows a file's own name apart from the folder holding it", () => {
    const html = renderChangesPanel([change({ path: "src/deep/file.ts" })], null);

    expect(html).toContain(">file.ts<");
    expect(html).toContain(">src&#x2F;deep<");
  });

  it("shows line counts only when Git reported them", () => {
    const withCounts = renderChangesPanel([change({ additions: 4, deletions: 2 })], null);
    const withoutCounts = renderChangesPanel([change({ additions: null, deletions: null })], null);

    expect(withCounts).toContain("+4");
    expect(withCounts).toContain("-2");
    expect(withoutCounts).not.toContain("changesFileCounts");
  });

  it("names where a renamed file came from", () => {
    const html = renderChangesPanel(
      [change({ path: "new.ts", oldPath: "old.ts", status: "R" })],
      null
    );

    expect(html).toContain("old.ts");
    expect(html).toContain('data-status="R"');
  });

  it("reports a clean tree and a failed read differently", () => {
    expect(renderChangesPanel([], null)).toContain("Nothing to commit");
    expect(renderChangesPanel([], "fatal: not a git repository")).toContain("not a git repository");
  });

  it("sorts each section by path", () => {
    const html = renderChangesPanel(
      [change({ path: "b.ts" }), change({ path: "a.ts" })],
      null
    );

    expect(html.indexOf(">a.ts<")).toBeLessThan(html.indexOf(">b.ts<"));
  });
});

function change(overrides: Partial<GitWorkingTreeChange> = {}): GitWorkingTreeChange {
  return {
    path: "src/a.ts",
    status: "M",
    staged: false,
    additions: 1,
    deletions: 1,
    submodule: null,
    ...overrides,
  };
}
