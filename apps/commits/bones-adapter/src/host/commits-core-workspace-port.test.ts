import { describe, expect, it, vi } from "vitest";
import { CommitsCoreWorkspacePort } from "./commits-core-workspace-port";

describe("CommitsCoreWorkspacePort", () => {
  it("presents bones repository paths through the MIT core contract", () => {
    const repositoryPaths = vi.fn(() => ["C:/code/one", "C:/code/two"]);
    const workspace = new CommitsCoreWorkspacePort({ repositoryPaths });

    expect(workspace.getRootPaths()).toEqual(["C:/code/one", "C:/code/two"]);
    expect(repositoryPaths).toHaveBeenCalledOnce();
    expect(workspace.getActiveRepoHint()).toBeNull();
  });

  it("provides disposable subscriptions while bones exposes snapshots only", () => {
    const workspace = new CommitsCoreWorkspacePort({ repositoryPaths: () => [] });

    expect(() => workspace.onDidChangeRootPaths(() => {}).dispose()).not.toThrow();
    expect(() => workspace.onDidChangeActiveRepoHint(() => {}).dispose()).not.toThrow();
  });
});
