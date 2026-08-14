import { beforeAll, describe, expect, it } from "vitest";
import type { GitWorkingTreeChange } from "../data-source/models";
import { renderChangesPanel } from "./changesPanelRender";

/** Answers every string lookup with its own key, so a test can assert on it. */
const l10nStub = new Proxy({}, { get: (_target, key) => String(key) });

beforeAll(() => {
  (globalThis as Record<string, unknown>).l10n = l10nStub;
  (globalThis as Record<string, unknown>).viewState = { fileIcons: {} };
});

const change = (
  path: string,
  overrides: Partial<GitWorkingTreeChange> = {}
): GitWorkingTreeChange =>
  <GitWorkingTreeChange>{
    path,
    staged: false,
    status: "M",
    additions: 1,
    deletions: 0,
    ...overrides,
  };

describe("renderChangesPanel", () => {
  it("nests changes under folders instead of listing paths beside names", () => {
    const html = renderChangesPanel([change("apps/host/src/settings.rs")], null);

    expect(html).toContain("gitFolderName");
    expect(html).toContain(">apps<");
    expect(html).toContain(">host<");
    expect(html).toContain(">settings.rs<");
    expect(html).not.toContain("changesFileDir");
  });

  it("puts staged and unstaged files in one tree, marking each row", () => {
    const html = renderChangesPanel(
      [change("src/a.ts", { staged: true }), change("src/b.ts")],
      null
    );

    expect([...html.matchAll(/gitFolderName">src</g)].length).toBe(1);
    expect(html).toContain('class="changesFile staged"');
    expect(html).toContain('class="changesFile unstaged"');
    expect([...html.matchAll(/changesFileStaged/g)].length).toBe(2);
  });

  it("keeps the data the row handlers read", () => {
    const html = renderChangesPanel([change("a.ts", { staged: true, status: "D" })], null);

    expect(html).toContain('data-path="a.ts"');
    expect(html).toContain('data-staged="true"');
    expect(html).toContain('data-status="D"');
  });

  it("renders each row as a list item, since the tree owns the list", () => {
    const html = renderChangesPanel([change("a.ts")], null);

    expect(html).toContain('<li class="changesFile');
    expect(html).not.toContain('<div class="changesFile');
  });

  it("keeps a folder closed when the caller remembers it that way", () => {
    const html = renderChangesPanel([change("src/a.ts")], null, new Set(["src"]));

    expect(html).toContain('<li class="closed">');
    expect(html).toContain("gitFolderContents hidden");
  });

  it("reports an error instead of a tree", () => {
    expect(renderChangesPanel([], "boom")).toContain("boom");
  });

  it("says there is nothing to commit when the tree is clean", () => {
    expect(renderChangesPanel([], null)).toContain("changesNothingToCommit");
  });

  it("offers unstage for a staged row and stage plus discard otherwise", () => {
    const staged = renderChangesPanel([change("a.ts", { staged: true })], null);
    const unstaged = renderChangesPanel([change("a.ts")], null);

    expect(staged).toContain('data-action="unstage"');
    expect(staged).not.toContain('data-action="discard"');
    expect(unstaged).toContain('data-action="stage"');
    expect(unstaged).toContain('data-action="discard"');
  });
});
