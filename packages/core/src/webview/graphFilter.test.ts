import { describe, expect, it } from "vitest";
import { filterGraph } from "./graphFilter";

/** A commit with only the fields the projection reads. */
const commit = (hash: string, ...parentHashes: string[]): GitCommitNode =>
  <GitCommitNode>{ hash, parentHashes };

/** Linear history, newest first, the order the graph receives. */
const linear = [commit("d", "c"), commit("c", "b"), commit("b", "a"), commit("a")];

describe("filterGraph", () => {
  it("keeps every commit and bridges nothing when all are visible", () => {
    const result = filterGraph(linear, () => true);

    expect(result.commits.map((c) => c.hash)).toEqual(["d", "c", "b", "a"]);
    expect(result.bridged.size).toBe(0);
    expect(result.lookup).toEqual({ d: 0, c: 1, b: 2, a: 3 });
  });

  it("reconnects a visible commit to the nearest visible ancestor", () => {
    const result = filterGraph(linear, (c) => c.hash === "d" || c.hash === "a");

    expect(result.commits.map((c) => c.hash)).toEqual(["d", "a"]);
    expect(result.commits[0].parentHashes).toEqual(["a"]);
    expect(result.lookup).toEqual({ d: 0, a: 1 });
  });

  it("reports an edge that had to skip commits as bridged", () => {
    const result = filterGraph(linear, (c) => c.hash === "d" || c.hash === "a");

    expect([...(result.bridged.get("d") ?? [])]).toEqual(["a"]);
  });

  it("leaves an adjacent edge unbridged", () => {
    const result = filterGraph(linear, (c) => c.hash === "d" || c.hash === "c");

    expect(result.commits[0].parentHashes).toEqual(["c"]);
    expect(result.bridged.size).toBe(0);
  });

  it("follows both sides of a merge to their nearest visible ancestors", () => {
    const history = [
      commit("m", "left", "right"),
      commit("left", "base"),
      commit("right", "base"),
      commit("base"),
    ];

    const result = filterGraph(history, (c) => c.hash === "m" || c.hash === "base");

    expect(result.commits[0].parentHashes).toEqual(["base"]);
    expect([...(result.bridged.get("m") ?? [])]).toEqual(["base"]);
  });

  it("keeps a merge's two parents apart when both survive the filter", () => {
    const history = [
      commit("m", "left", "right"),
      commit("left", "hidden"),
      commit("right", "base"),
      commit("hidden", "base"),
      commit("base"),
    ];

    const result = filterGraph(history, (c) => c.hash !== "hidden");

    expect(result.commits[0].parentHashes).toEqual(["left", "right"]);
    expect(result.bridged.has("m")).toBe(false);
    expect(result.commits[1].parentHashes).toEqual(["base"]);
    expect([...(result.bridged.get("left") ?? [])]).toEqual(["base"]);
  });

  it("stops at a parent whose commit has not been loaded", () => {
    const result = filterGraph([commit("only", "missing")], () => true);

    expect(result.commits[0].parentHashes).toEqual([]);
    expect(result.bridged.size).toBe(0);
  });

  it("does not loop forever on history that refers back to itself", () => {
    const cyclic = [commit("a", "b"), commit("b", "a")];

    const result = filterGraph(cyclic, (c) => c.hash === "a");

    expect(result.commits.map((c) => c.hash)).toEqual(["a"]);
    expect(result.commits[0].parentHashes).toEqual([]);
  });

  it("marks only the edges that actually skip commits, along one chain", () => {
    // d -> c -> b -> a with c hidden: d reaches b over a gap, b reaches a
    // directly. A branch must not take one state for all of its edges.
    const result = filterGraph(linear, (commit) => commit.hash !== "c");

    expect(result.commits.map((c) => c.hash)).toEqual(["d", "b", "a"]);
    expect([...(result.bridged.get("d") ?? [])]).toEqual(["b"]);
    expect(result.bridged.has("b")).toBe(false);
  });

  it("returns nothing when the filter matches nothing", () => {
    const result = filterGraph(linear, () => false);

    expect(result.commits).toEqual([]);
    expect(result.lookup).toEqual({});
  });
});
