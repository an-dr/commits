import { describe, expect, it } from "vitest";
import { parseSubmodulePaths } from "./submodule-status";

describe("parseSubmodulePaths", () => {
  it("reads nested submodule paths from --recursive output", () => {
    const stdout = [
      " 6d769aa0f01d86acd112cf59869bfbc5f79abd1d vendor/bones (heads/main)",
      " e425e3d2f92c96d2146f83a1b23de235c75d1758 vendor/bones/agents (heads/main)",
      " 0200cd23a33886a189787b2845fc9834a0530587 vendor/bones/vendor/pubsub-bus (v3.1.0-1-g0200cd2)",
      "",
    ].join("\n");

    expect(parseSubmodulePaths(stdout)).toEqual([
      "vendor/bones",
      "vendor/bones/agents",
      "vendor/bones/vendor/pubsub-bus",
    ]);
  });

  it("reads uninitialized and out-of-sync markers the same as up to date", () => {
    const stdout = [
      "-6d769aa0f01d86acd112cf59869bfbc5f79abd1d vendor/uninitialized",
      "+e425e3d2f92c96d2146f83a1b23de235c75d1758 vendor/out-of-sync (heads/main)",
      "U0200cd23a33886a189787b2845fc9834a0530587 vendor/conflicted",
    ].join("\n");

    expect(parseSubmodulePaths(stdout)).toEqual([
      "vendor/uninitialized",
      "vendor/out-of-sync",
      "vendor/conflicted",
    ]);
  });

  it("returns nothing for a repository with no submodules", () => {
    expect(parseSubmodulePaths("")).toEqual([]);
  });
});
