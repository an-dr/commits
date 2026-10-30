import { describe, expect, it } from "vitest";
import { nextBranchSelection } from "@an-dr/commits-core/webview/branchSelection";

describe("nextBranchSelection", () => {
  it("replaces the selection on a plain click", () => {
    expect(nextBranchSelection(["main", "dev"], "release", false)).toEqual(["release"]);
  });

  it("adds a branch when holding the modifier", () => {
    expect(nextBranchSelection(["main"], "dev", true)).toEqual(["main", "dev"]);
  });

  it("removes an already selected branch when holding the modifier", () => {
    expect(nextBranchSelection(["main", "dev"], "dev", true)).toEqual(["main"]);
  });

  it("falls back to every ref when the last branch is removed", () => {
    expect(nextBranchSelection(["main"], "main", true)).toEqual([""]);
  });

  it("keeps show all exclusive", () => {
    expect(nextBranchSelection(["main", "dev"], "", true)).toEqual([""]);
    expect(nextBranchSelection([""], "main", true)).toEqual(["main"]);
  });
});
