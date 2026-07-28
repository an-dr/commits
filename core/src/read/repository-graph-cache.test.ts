import { describe, expect, it } from "vitest";
import { RepositoryGraphCache } from "./repository-graph-cache";

describe("RepositoryGraphCache", () => {
  it("retains bounded LRU commits and exact projections", () => {
    const cache = new RepositoryGraphCache<{ hash: string }, string>(2, 1);
    cache.setProjection("repo", "one", [{ hash: "a" }, { hash: "b" }], "first");
    cache.getCommit("repo", "a");
    cache.setProjection("repo", "two", [{ hash: "c" }], "second");
    expect(cache.getCommit("repo", "b")).toBeNull();
    expect(cache.getCommit("repo", "a")).toEqual({ hash: "a" });
    expect(cache.getProjection("repo", "one")).toBeNull();
    expect(cache.getProjection("repo", "two")).toEqual({ value: "second", stale: false });
  });

  it("marks projections stale until a watcher observation is resolved", () => {
    const cache = new RepositoryGraphCache<{ hash: string }, string>();
    cache.setProjection("repo", "all", [{ hash: "a" }], "graph");
    cache.markUnverified("repo");
    expect(cache.getProjection("repo", "all")?.stale).toBe(true);
    cache.confirmVerified("repo");
    expect(cache.getProjection("repo", "all")?.stale).toBe(false);
    const generation = cache.generation("repo");
    cache.advanceGeneration("repo");
    expect(cache.setForGeneration("repo", "late", generation, [], "late")).toBe(false);
  });
});
