import { beforeAll, describe, expect, it } from "vitest";
import { createLocalizedStrings } from "@an-dr/commits-webview-shell/l10n";
import type { GitWorkingTreeChange } from "@an-dr/commits-core/data-source/models";
import {
  renderChangesFooter,
  renderChangesPanel,
} from "@an-dr/commits-core/webview/changesPanelRender";

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

  it("marks each row staged or unstaged, having no section to say it", () => {
    const html = renderChangesPanel(
      [
        change({ path: "one.ts", staged: true }),
        change({ path: "two.ts", staged: true }),
        change({ path: "three.ts", staged: false }),
      ],
      null
    );

    expect([...html.matchAll(/class="changesFile staged"/g)].length).toBe(2);
    expect([...html.matchAll(/class="changesFile unstaged"/g)].length).toBe(1);
  });

  it("nests a file under one folder per path segment", () => {
    const html = renderChangesPanel([change({ path: "src/deep/file.ts" })], null);

    expect(html).toContain(">file.ts<");
    expect(html).toContain(">src<");
    expect(html).toContain(">deep<");
    expect(html).not.toContain("changesFileDir");
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

  it("offers each side only the actions that apply to it", () => {
    const html = renderChangesPanel(
      [change({ path: "staged.ts", staged: true }), change({ path: "live.ts", staged: false })],
      null
    );
    // One tree orders by name, so the rows are found by path rather than by
    // assuming the staged one comes first.
    const rowFor = (path: string): string => {
      const start = html.indexOf(`data-path="${path}"`);
      return html.slice(start, html.indexOf("</li>", start));
    };
    const stagedRow = rowFor("staged.ts");
    const unstagedRow = rowFor("live.ts");

    expect(stagedRow).toContain('data-action="unstage"');
    expect(stagedRow).not.toContain('data-action="discard"');
    expect(unstagedRow).toContain('data-action="stage"');
    expect(unstagedRow).toContain('data-action="discard"');
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

describe("renderChangesFooter", () => {
  it("keeps the message the user typed and the amend choice", () => {
    const html = renderChangesFooter("half-written message", true);

    expect(html).toContain("half-written message");
    expect(html).toContain('id="changesAmend" type="checkbox" checked');
    expect(html).toContain("Commit");
  });

  it("escapes a message that looks like markup", () => {
    const html = renderChangesFooter("<script>alert(1)</script>", false);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
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
