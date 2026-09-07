import { describe, expect, it } from "vitest";
import { parseSubmoduleEntries } from "./submodule-status";

describe("parseSubmoduleEntries", () => {
  it("tells the four states apart by their leading marker", () => {
    const stdout = [
      " 7db87137f0bbec0c75a94ab93c7544764af84517 vendor/current (abi-v1.0.0)",
      "-6d769aa0f01d86acd112cf59869bfbc5f79abd1d vendor/uninitialized",
      "+e425e3d2f92c96d2146f83a1b23de235c75d1758 vendor/out-of-sync (heads/main)",
      "U0200cd23a33886a189787b2845fc9834a0530587 vendor/conflicted",
    ].join("\n");

    expect(parseSubmoduleEntries(stdout)).toEqual([
      { path: "vendor/current", state: "upToDate" },
      { path: "vendor/uninitialized", state: "uninitialized" },
      { path: "vendor/out-of-sync", state: "outOfDate" },
      { path: "vendor/conflicted", state: "conflicted" },
    ]);
  });

  it("reads nested submodule paths from --recursive output", () => {
    const stdout = [
      " 7db87137f0bbec0c75a94ab93c7544764af84517 vendor/bones (abi-v1.0.0)",
      " 0200cd23a33886a189787b2845fc9834a0530587 vendor/bones/vendor/pubsub-bus (v3.1.0-1-g0200cd2)",
      "",
    ].join("\n");

    expect(parseSubmoduleEntries(stdout).map((entry) => entry.path)).toEqual([
      "vendor/bones",
      "vendor/bones/vendor/pubsub-bus",
    ]);
  });

  it("returns nothing for a repository with no submodules", () => {
    expect(parseSubmoduleEntries("")).toEqual([]);
  });

  it("keeps a path that contains spaces, dropping only the describe suffix", () => {
    const stdout = " 7db87137f0bbec0c75a94ab93c7544764af84517 vendor/my libs/bones (v1.0.0)";

    expect(parseSubmoduleEntries(stdout)).toEqual([
      { path: "vendor/my libs/bones", state: "upToDate" },
    ]);
  });

  it("ignores lines that are not a status line, and CRLF endings", () => {
    const stdout = "warning: something\r\n-6d769aa0f01d86acd112cf59869bfbc5f79abd1d vendor/x\r\n";

    expect(parseSubmoduleEntries(stdout)).toEqual([
      { path: "vendor/x", state: "uninitialized" },
    ]);
  });
});

it("preserves parentheses and whitespace in uninitialized paths", () => {
  expect(parseSubmoduleEntries("-" + "a".repeat(40) + " vendor/lib (old) ")).toEqual([
    { path: "vendor/lib (old) ", state: "uninitialized" },
  ]);
});
it("accepts SHA-256 submodule status", () => {
  expect(parseSubmoduleEntries("-" + "a".repeat(64) + " vendor/lib")).toEqual([
    { path: "vendor/lib", state: "uninitialized" },
  ]);
});
