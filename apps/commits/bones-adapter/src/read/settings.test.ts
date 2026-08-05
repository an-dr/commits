import { describe, expect, it } from "vitest";
import {
  CORE_SETTING_DEFINITIONS,
  DEFAULT_SETTINGS,
  parseSettings,
  validateSettings,
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
