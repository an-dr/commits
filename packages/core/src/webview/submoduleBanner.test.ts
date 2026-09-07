import { beforeAll, describe, expect, it } from "vitest";
import type { SubmoduleView } from "../types";
import { formatPaths, pending, signature, stateLabel } from "./submoduleBanner";

/** Answers every string lookup with its own key, so a test can assert on it. */
const l10nStub = new Proxy(
  {},
  {
    get: (_target, key) => {
      const name = String(key);
      return name === "submodulesMore" ? "and {0} more" : name;
    }
  }
);

beforeAll(() => {
  (globalThis as Record<string, unknown>).l10n = l10nStub;
});

const sub = (path: string, state: SubmoduleView["state"]): SubmoduleView => ({ path, state });

describe("pending", () => {
  it("keeps only the submodules that are not at the recorded commit", () => {
    expect(
      pending([
        sub("a", "upToDate"),
        sub("b", "uninitialized"),
        sub("c", "outOfDate"),
        sub("d", "conflicted")
      ])
    ).toEqual([sub("b", "uninitialized"), sub("c", "outOfDate"), sub("d", "conflicted")]);
  });
});

describe("formatPaths", () => {
  it("names each path with the state it is in", () => {
    expect(formatPaths([sub("vendor/bones", "uninitialized")])).toBe(
      "vendor/bones (submodulesUninitialized)"
    );
  });

  it("counts the rest rather than listing every path of a deep tree", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((path) => sub(path, "outOfDate"));

    const text = formatPaths(many);

    expect(text).toContain("a (");
    expect(text).toContain("d (");
    expect(text).not.toContain("e (");
    expect(text).toContain("and 2 more");
  });
});

describe("signature", () => {
  it("changes when a submodule is added, so a dismissal cannot hide it", () => {
    const before = signature("/repo", [sub("vendor/bones", "outOfDate")]);
    const after = signature("/repo", [sub("vendor/bones", "outOfDate"), sub("vendor/new", "uninitialized")]);

    expect(after).not.toBe(before);
  });

  it("changes when the same submodule moves to another state", () => {
    expect(signature("/repo", [sub("a", "outOfDate")])).not.toBe(
      signature("/repo", [sub("a", "uninitialized")])
    );
  });

  it("is stable across a refresh that found the same thing", () => {
    expect(signature("/repo", [sub("a", "outOfDate")])).toBe(
      signature("/repo", [sub("a", "outOfDate")])
    );
  });
});

describe("stateLabel", () => {
  it("names every state the parser can report", () => {
    expect(stateLabel("uninitialized")).toBe("submodulesUninitialized");
    expect(stateLabel("outOfDate")).toBe("submodulesOutOfDate");
    expect(stateLabel("conflicted")).toBe("submodulesConflicted");
    expect(stateLabel("upToDate")).toBe("submodulesUpToDate");
  });
});
