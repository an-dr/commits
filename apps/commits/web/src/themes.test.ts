import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@commits/adapter/read/settings";
import { DARK_THEMES, LIGHT_THEMES, resolveAppearance, parseThemeFile, sessionAfterSettingsChange } from "./themes";

describe("standalone appearance", () => {
  const file = () => ({ version: 1, name: "Caller", light: { colours: { ...LIGHT_THEMES[0].colours, ignored: "future" } }, dark: { colours: DARK_THEMES[0].colours } });
  it("validates complete palettes, ignores future keys and uses default syntax", () => {
    const parsed = parseThemeFile(file());
    expect(parsed).not.toBeInstanceOf(Error);
    if (parsed instanceof Error) throw parsed;
    expect(parsed.light.syntax).toEqual(LIGHT_THEMES[0].syntax);
    expect(parsed.light.colours).not.toHaveProperty("ignored");
    expect(resolveAppearance(DEFAULT_SETTINGS, false, { mode: "dark", file: parsed }).name).toBe("Caller");
  });
  it("rejects missing keys, unsupported versions and invalid colors", () => {
    expect(parseThemeFile({ ...file(), version: 2 })).toBeInstanceOf(Error);
    expect(parseThemeFile({ ...file(), light: { colours: { canvas: "#fff" } } })).toBeInstanceOf(Error);
    for (const canvas of ["red", "rgba(256,0,0,1)", "rgba(0,0,0,1.2)", "url(x)", "#12345"]) {
      expect(parseThemeFile({ ...file(), light: { colours: { ...LIGHT_THEMES[0].colours, canvas } } })).toBeInstanceOf(Error);
    }
  });
  it("lets a preset saved in Settings replace the session palette", () => {
    const parsed = parseThemeFile(file());
    if (parsed instanceof Error) throw parsed;
    const session = { mode: "dark" as const, file: parsed };
    const renamed = { ...DEFAULT_SETTINGS, app: { ...DEFAULT_SETTINGS.app, darkTheme: "midnight" } };
    expect(sessionAfterSettingsChange(session, DEFAULT_SETTINGS, renamed)).toEqual({ mode: "dark", file: undefined });
    expect(resolveAppearance(renamed, true, sessionAfterSettingsChange(session, DEFAULT_SETTINGS, renamed)).id).toBe("midnight");
    expect(sessionAfterSettingsChange(session, DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual(session);
  });
  it("ships separate light and dark theme catalogs", () => {
    expect(LIGHT_THEMES.map(({ id }) => id)).toEqual(["paper", "solarized-light", "high-contrast-light"]);
    expect(DARK_THEMES.map(({ id }) => id)).toEqual(["graphite", "midnight", "high-contrast-dark"]);
  });

  it("follows system mode without losing either selected theme", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      app: { ...DEFAULT_SETTINGS.app, mode: "system" as const, lightTheme: "solarized-light", darkTheme: "midnight" },
    };
    expect(resolveAppearance(settings, false).id).toBe("solarized-light");
    expect(resolveAppearance(settings, true).id).toBe("midnight");
  });

  it("falls back inside the selected mode for unknown future theme ids", () => {
    expect(resolveAppearance({ ...DEFAULT_SETTINGS, app: { ...DEFAULT_SETTINGS.app, mode: "dark", darkTheme: "future" } }, false).id)
      .toBe("graphite");
  });

  it("gives every preset a full syntax palette readable against its canvas", () => {
    for (const theme of [...LIGHT_THEMES, ...DARK_THEMES]) {
      expect(Object.keys(theme.syntax)).toHaveLength(10);
      for (const [token, colour] of Object.entries(theme.syntax)) {
        expect(contrast(colour, theme.colours.canvas), `${theme.id} ${token}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
