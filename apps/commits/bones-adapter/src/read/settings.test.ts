import { describe, expect, it } from "vitest";
import {
  CORE_SETTING_DEFINITIONS,
  DEFAULT_SETTINGS,
  parseSettings,
  toolPreset,
  validateSettings,
  MAX_TOOLS,
  TOOLS_KEY,
  validateTools,
  VS_CODE_TOOL,
  type ToolSetting,
} from "./settings";

describe("settings document", () => {
  it("contains every setting in the MIT extension manifest", () => {
    expect(CORE_SETTING_DEFINITIONS).toHaveLength(40);
    expect(CORE_SETTING_DEFINITIONS.map(({ key }) => key)).toContain("an-dr-com-mit-s.keyboardShortcut.refresh");
    expect(DEFAULT_SETTINGS.core["an-dr-com-mit-s.loadMoreCommits"]).toBe(100);
  });

  it("uses defaults for absent, corrupt, or unsupported documents", () => {
    expect(parseSettings("not json")).toBe(DEFAULT_SETTINGS);
    expect(validateSettings({ version: 3, core: {}, app: {} })).toBe(DEFAULT_SETTINGS);
  });

  it("validates known settings independently and preserves future keys", () => {
    const settings = validateSettings({
      version: 2,
      core: {
        "an-dr-com-mit-s.graphStyle": "invalid",
        "an-dr-com-mit-s.initialLoadCommits": 500,
        "an-dr-com-mit-s.futureSetting": { enabled: true },
      },
      app: { mode: "dark", lightTheme: "custom-light", futureSetting: true },
    });

    expect(settings.core["an-dr-com-mit-s.graphStyle"]).toBe("rounded");
    expect(settings.core["an-dr-com-mit-s.initialLoadCommits"]).toBe(500);
    expect(settings.core["an-dr-com-mit-s.futureSetting"]).toEqual({ enabled: true });
    expect(settings.app).toMatchObject({ mode: "dark", lightTheme: "custom-light", darkTheme: "graphite", futureSetting: true });
  });

  it("ships VS Code configured, so the button is there to be found", () => {
    expect(DEFAULT_SETTINGS.app[TOOLS_KEY]).toEqual([VS_CODE_TOOL]);
    // A document written before tools existed says nothing about them, so it
    // takes the default rather than losing the feature silently.
    expect(validateSettings({ version: 2, core: {}, app: {} }).app[TOOLS_KEY]).toEqual([VS_CODE_TOOL]);
  });

  it("reads a document written before the key was namespaced", () => {
    const tools = [{ name: "Meld", command: "meld", openArgs: [], diffArgs: ["{left}", "{right}"] }];

    expect(validateSettings({ version: 2, core: {}, app: { tools } }).app[TOOLS_KEY]).toEqual(tools);
  });

  it("keeps at most five tools, however many the file lists", () => {
    const many = Array.from({ length: 8 }, (_unused, index) => ({
      name: `Tool ${index}`,
      command: `tool${index}`,
      openArgs: ["{repo}"],
      diffArgs: [],
    }));

    const kept = validateSettings({ version: 2, core: {}, app: { [TOOLS_KEY]: many } }).app[TOOLS_KEY];

    expect(kept).toHaveLength(MAX_TOOLS);
    expect(kept.map((tool: ToolSetting) => tool.command)).toEqual([
      "tool0", "tool1", "tool2", "tool3", "tool4",
    ]);
  });

  it("leaves an empty list empty, which is how the tool is turned off", () => {
    expect(validateSettings({ version: 2, core: {}, app: { [TOOLS_KEY]: [] } }).app[TOOLS_KEY]).toEqual([]);
  });

  it("recognizes which preset a stored tool is, for the editor's selector", () => {
    expect(toolPreset(VS_CODE_TOOL)).toBe("vscode");
    expect(toolPreset(undefined)).toBe("none");
    expect(toolPreset({ name: "Meld", command: "meld", openArgs: [], diffArgs: ["{left}"] }))
      .toBe("custom");
    // Same program, different arguments: no longer the preset, or choosing it
    // again would quietly overwrite what the user changed.
    expect(toolPreset({ ...VS_CODE_TOOL, openArgs: ["-n", "{repo}"] })).toBe("custom");
  });

  it("keeps the usable tools and drops only the broken ones", () => {
    const tools = validateTools([
      { name: "VS Code", command: "code", openArgs: ["{repo}"], diffArgs: ["--diff", "{left}", "{right}"] },
      { name: "No command" },
      { command: "meld" },
      { command: "kdiff3", openArgs: "{repo}", diffArgs: ["{left}", 7, "{right}"] },
      "not a tool",
    ]);

    expect(tools).toEqual([
      { name: "VS Code", command: "code", openArgs: ["{repo}"], diffArgs: ["--diff", "{left}", "{right}"] },
      // A tool with no name of its own is known by the command that runs it.
      { name: "meld", command: "meld", openArgs: [], diffArgs: [] },
      // Arguments that are not strings cannot be passed to a program, and the
      // rest of the tool is still usable without them.
      { name: "kdiff3", command: "kdiff3", openArgs: [], diffArgs: ["{left}", "{right}"] },
    ]);
  });

  it("carries configured tools through a document, in the order given", () => {
    const settings = validateSettings({
      version: 2,
      core: {},
      app: {
        tools: [
          { name: "VS Code", command: "code", openArgs: ["{repo}"], diffArgs: [] },
          { name: "Meld", command: "meld", openArgs: [], diffArgs: ["{left}", "{right}"] },
        ],
      },
    });

    expect(settings.app[TOOLS_KEY].map((tool: ToolSetting) => tool.name)).toEqual(["VS Code", "Meld"]);
  });

  it("migrates the v1 standalone fields from either root or Bones state", () => {
    const legacy = { version: 1, commitLimit: 750, includeRemotes: false, theme: "light" };

    for (const candidate of [legacy, { settings: legacy, state: { recent: [] } }]) {
      const migrated = validateSettings(candidate);
      expect(migrated.version).toBe(2);
      expect(migrated.core["an-dr-com-mit-s.initialLoadCommits"]).toBe(750);
      expect(migrated.app.mode).toBe("light");
    }
  });
});
