import { describe, expect, it } from "vitest";
import { parseLog, parseRefSnapshot } from "./parsers";

describe("read parsers", () => {
  it("parses Unicode commits and skips malformed records", () => {
    const sep = "\u001f";
    expect(parseLog([
      ["abc1234", "parent", "Žluťoučký", "mail@example.com", "42", "Příliš"].join(sep),
      "broken",
    ].join("\n"), sep)).toEqual([{
      hash: "abc1234", parents: ["parent"], author: "Žluťoučký", email: "mail@example.com", date: 42, subject: "Příliš",
    }]);
  });

  it("parses branch, annotated tag, and remote snapshot records", () => {
    const sep = "\u001f";
    const output = [
      ["abc1234", "refs/heads/main", ""].join(sep),
      ["abc1234", "refs/tags/v1", "def5678"].join(sep),
      ["abc1234", "refs/remotes/origin/main", ""].join(sep),
    ].join("\n");
    expect(parseRefSnapshot(output, "abc1234", sep)).toEqual({
      head: "abc1234",
      branches: [{ name: "main", hash: "abc1234" }],
      tags: [{ name: "v1", hash: "def5678", annotated: true }],
      remotes: [{ name: "origin/main", hash: "abc1234" }],
    });
  });

  it("rejects oversized component parser input", () => {
    expect(() => parseLog("x".repeat(128 * 1024 + 1))).toThrow("parser budget");
  });
});
