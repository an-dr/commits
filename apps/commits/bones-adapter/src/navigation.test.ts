import { describe, expect, it } from "vitest";
import { applyNavigation } from "./navigation";
describe("navigation", () => {
  for (const show of ["changes", "conflicts", "graph"] as const) it(`navigates ${show}`, () => {
    const calls: string[] = [];
    applyNavigation({ show }, { selectWorkingTree: () => calls.push("changes"), selectGraph: () => calls.push("graph"), selectRevision: () => calls.push("revision") });
    expect(calls).toEqual([show === "graph" ? "graph" : "changes"]);
  });
  it("prefers a commit over branch and view", () => {
    const calls: unknown[] = [];
    applyNavigation({ commit: "abcd", branch: "main", show: "changes" }, { selectWorkingTree: () => calls.push("changes"), selectGraph: () => {}, selectRevision: (revision, branch) => calls.push([revision, branch]) });
    expect(calls).toEqual([["abcd", false]]);
  });
});
