import { describe, expect, it } from "vitest";
import type { ToolView } from "@an-dr/commits-core/types";
import { diffTool, openInMenuEntries, repositoryTools } from "./externalTools";

const tool = (name: string, extra: Partial<ToolView> = {}): ToolView => ({
  name,
  command: name.toLowerCase(),
  openArgs: [],
  diffArgs: [],
  ...extra
});

describe("repositoryTools", () => {
  it("offers nothing when the host configures nothing", () => {
    expect(repositoryTools(undefined)).toEqual([]);
    expect(repositoryTools([])).toEqual([]);
  });

  it("keeps the configured order, which is the user's preference", () => {
    const tools = [
      tool("VS Code", { openArgs: ["{repo}"] }),
      tool("Meld", { diffArgs: ["{left}", "{right}"] }),
      tool("Sublime", { openArgs: ["{repo}"] })
    ];

    expect(repositoryTools(tools).map((entry) => entry.name)).toEqual(["VS Code", "Sublime"]);
  });

  it("skips a tool with no command to run", () => {
    expect(repositoryTools([tool("Broken", { command: "", openArgs: ["{repo}"] })])).toEqual([]);
  });
});

describe("diffTool", () => {
  it("takes the first tool that can diff, so the order decides", () => {
    const tools = [
      tool("VS Code", { openArgs: ["{repo}"] }),
      tool("Meld", { diffArgs: ["{left}", "{right}"] }),
      tool("KDiff3", { diffArgs: ["{left}", "{right}"] })
    ];

    expect(diffTool(tools)?.name).toBe("Meld");
  });

  it("is null when no tool diffs, which leaves the built-in panel in charge", () => {
    expect(diffTool(undefined)).toBeNull();
    expect(diffTool([tool("VS Code", { openArgs: ["{repo}"] })])).toBeNull();
  });
});

describe("openInMenuEntries", () => {
  it("lists the tools, then a way to change them", () => {
    const tools = [
      tool("VS Code", { openArgs: ["{repo}"] }),
      tool("Sublime", { openArgs: ["{repo}"] })
    ];

    expect(openInMenuEntries(tools)).toEqual([
      { kind: "tool", tool: tools[0] },
      { kind: "tool", tool: tools[1] },
      { kind: "separator" },
      { kind: "configure" }
    ]);
  });

  it("is worth opening with a single tool, which is why configure is in it", () => {
    const tools = [tool("VS Code", { openArgs: ["{repo}"] })];

    expect(openInMenuEntries(tools).map((entry) => entry.kind)).toEqual([
      "tool",
      "separator",
      "configure"
    ]);
  });

  it("skips the separator when there is nothing above it", () => {
    expect(openInMenuEntries([])).toEqual([{ kind: "configure" }]);
  });
});
