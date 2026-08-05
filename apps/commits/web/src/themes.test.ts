import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@commits/adapter/read/settings";
import { DARK_THEMES, LIGHT_THEMES, resolveAppearance } from "./themes";

describe("standalone appearance", () => {
  it("ships separate light and dark theme catalogs", () => {
    expect(LIGHT_THEMES.map(({ id }) => id)).toEqual(["paper", "solarized-light", "high-contrast-light"]);
    expect(DARK_THEMES.map(({ id }) => id)).toEqual(["graphite", "midnight", "high-contrast-dark"]);
  });

  it("follows system mode without losing either selected theme", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      app: { mode: "system" as const, lightTheme: "solarized-light", darkTheme: "midnight" },
    };
    expect(resolveAppearance(settings, false).id).toBe("solarized-light");
    expect(resolveAppearance(settings, true).id).toBe("midnight");
  });

  it("falls back inside the selected mode for unknown future theme ids", () => {
    expect(resolveAppearance({ ...DEFAULT_SETTINGS, app: { ...DEFAULT_SETTINGS.app, mode: "dark", darkTheme: "future" } }, false).id)
      .toBe("graphite");
  });
});
