import { beforeAll, describe, expect, it } from "vitest";
import { createLocalizedStrings } from "@an-dr/commits-webview-shell/l10n";
import { NO_REMOTE_INFO, type BranchPanelRenderModel } from "@an-dr/commits-core/webview/branchPanel";
import { renderBranchPanel } from "@an-dr/commits-core/webview/branchPanelRender";
import { toolbarIcons } from "@an-dr/commits-core/webview/utils/icons";

/** The panel reads its strings from the page global the host installs. */
beforeAll(() => {
  globalThis.l10n = createLocalizedStrings((text) => text);
});

describe("renderBranchPanel", () => {
  it("names HEAD and the revision it resolves to above the branches", () => {
    const html = render({ head: { branch: "main", hash: "562d6b81cafe0000" } });

    expect(html).toContain(">HEAD<");
    expect(html).toContain("(562d6b81)");
    // The row precedes the sections, as a Git client's panel shows it.
    expect(html.indexOf("branchPanelHeadRow")).toBeLessThan(html.indexOf("Local Branches"));
  });

  it("selects the current branch from the HEAD row", () => {
    const html = render({ head: { branch: "main", hash: "562d6b81" } });

    expect(html).toMatch(/branchPanelHeadRow" data-value="main"/);
  });

  it("reports a detached HEAD without offering a branch to select", () => {
    const html = render({
      head: { branch: null, hash: "562d6b81" },
      options: [{ name: "main", value: "main", selected: false, current: false }],
    });

    expect(html).toContain("(562d6b81)");
    expect(html).not.toMatch(/branchPanelHeadRow" data-value/);
  });

  it("omits the HEAD row while a filter narrows the panel to refs", () => {
    const html = render({ head: { branch: "main", hash: "562d6b81" }, filter: "dev" });

    expect(html).not.toContain("branchPanelHeadRow");
  });

  it("counts local branches under one header", () => {
    const html = render({
      options: [
        { name: "main", value: "main", selected: false, current: true },
        { name: "fix/one", value: "fix/one", selected: false, current: false },
        { name: "fix/two", value: "fix/two", selected: false, current: false },
      ],
    });

    expect(html).toContain("Local Branches (3)");
  });

  it("gives each remote its own section named after the remote", () => {
    const html = render({
      options: [
        { name: "main", value: "main", selected: false, current: true },
        { name: "origin/main", value: "remotes/origin/main", selected: false, current: false },
        { name: "origin/fix/one", value: "remotes/origin/fix/one", selected: false, current: false },
        { name: "upstream/main", value: "remotes/upstream/main", selected: false, current: false },
      ],
    });

    expect(html).toContain("origin (2)");
    expect(html).toContain("upstream (1)");
    // The remote name lives in the header, so its refs are not repeated under
    // it, but the row still reports the whole ref it stands for.
    expect(html).not.toContain(">origin/<");
    // Slashes arrive HTML-escaped, as every attribute the panel writes does.
    expect(html).toContain('title="origin&#x2F;fix&#x2F;one"');
  });

  it("draws folders as disclosure rows without a trailing separator", () => {
    const html = render({
      options: [
        { name: "fix/one", value: "fix/one", selected: false, current: false },
        { name: "fix/two", value: "fix/two", selected: false, current: false },
      ],
    });

    expect(html).toContain("branchPanelTwisty");
    expect(html).toContain(">fix<");
    expect(html).not.toContain(">fix/<");
  });

  it("collapses a folder the user closed", () => {
    const html = render({
      options: [{ name: "fix/one", value: "fix/one", selected: false, current: false }],
      collapsedFolders: new Set(["local/fix"]),
    });

    expect(html).toContain(toolbarIcons.chevronRight);
    expect(html).not.toContain(">one<");
  });

  it("marks the checked-out branch and mirrors its selection onto the HEAD row", () => {
    const html = render({
      head: { branch: "main", hash: "562d6b81" },
      options: [
        { name: "main", value: "main", selected: true, current: true },
        { name: "dev", value: "dev", selected: false, current: false },
      ],
    });

    expect(html).toContain("branchPanelCurrentMarker");
    // The branch row and the HEAD row that stands for it are both checked.
    expect(html.match(/branchPanelCheck">✓/g)).toHaveLength(2);
  });

  it("names the remote a branch tracks, and the whole upstream when the names differ", () => {
    const html = render({
      options: [
        { name: "main", value: "main", selected: false, current: true },
        { name: "work", value: "work", selected: false, current: false },
        { name: "local-only", value: "local-only", selected: false, current: false },
      ],
      remoteInfo: {
        upstreams: { main: "origin/main", work: "origin/other" },
        remotes: {},
      },
    });

    expect(html).toContain("= origin<");
    expect(html).toContain("= origin&#x2F;other<");
    expect(html.match(/branchPanelTracking/g)).toHaveLength(2);
  });

  it("shows a remote's fetch URL beside its header", () => {
    const html = render({
      options: [{ name: "origin/main", value: "remotes/origin/main", selected: false, current: false }],
      remoteInfo: { upstreams: {}, remotes: { origin: "https://github.com/an-dr/commits" } },
    });

    expect(html).toContain("origin (1)");
    expect(html).toContain("https:&#x2F;&#x2F;github.com&#x2F;an-dr&#x2F;commits");
    // The name and count stay together; only the URL beside them may shrink.
    expect(html).toContain('<span class="branchPanelSectionName">origin (1)</span>');
  });

  it("renders without tracking data, which is what a host that sends none gets", () => {
    const html = render({ options: [{ name: "main", value: "main", selected: false, current: true }] });

    expect(html).toContain("Local Branches (1)");
    expect(html).not.toContain("branchPanelTracking");
  });

  it("reports no matching branches when the filter excludes every ref", () => {
    const html = render({ filter: "nothing-matches" });

    expect(html).toContain("No matching branches");
  });
});

describe("foldable sections", () => {
  const withTags = {
    options: [
      { name: "main", value: "main", selected: false, current: true },
      { name: "v1.0.0", value: "tags/v1.0.0", selected: false, current: false },
    ],
  };

  it("gives every section a twisty of its own", () => {
    const html = render(withTags);

    expect([...html.matchAll(/branchPanelSectionHeader branchPanelFolder/g)].length).toBe(2);
    expect(html).toContain('data-folder="local"');
    expect(html).toContain('data-folder="tags"');
  });

  it("lists tags in their own section", () => {
    const html = render(withTags);

    expect(html).toContain("Tags (1)");
    expect(html).toContain(">v1.0.0<");
  });

  it("hides a collapsed section's refs but keeps its header", () => {
    const html = render({ ...withTags, collapsedFolders: new Set(["tags"]) });

    expect(html).toContain('data-folder="tags"');
    expect(html).toContain("Tags (1)");
    expect(html).not.toContain(">v1.0.0<");
    // Folding one section leaves the others alone.
    expect(html).toContain(">main<");
  });

  it("marks a collapsed section closed and an open one open", () => {
    const collapsed = render({ ...withTags, collapsedFolders: new Set(["tags"]) });

    const tagsHeader = collapsed.slice(collapsed.indexOf('data-folder="tags"'));
    expect(tagsHeader).toContain(toolbarIcons.chevronRight);
    expect(render(withTags).slice(render(withTags).indexOf('data-folder="tags"'))).toContain(
      toolbarIcons.chevronDown
    );
  });
});

function render(overrides: Partial<BranchPanelRenderModel> = {}): string {
  return renderBranchPanel({
    options: [{ name: "main", value: "main", selected: false, current: true }],
    head: { branch: null, hash: null },
    remoteInfo: NO_REMOTE_INFO,
    filter: "",
    collapsedFolders: new Set(),
    groupsFirst: true,
    flattenSingleChildGroups: false,
    ...overrides,
  });
}
