import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, FileBackedSettings, parseSettings, validateSettings } from "./settings";

describe("FileBackedSettings", () => {
  it("uses defaults for an absent or corrupt file", () => {
    const storage = { load: () => new TextEncoder().encode("not json"), save: () => undefined };
    expect(new FileBackedSettings(storage).load()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists only valid versioned JSON settings", () => {
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const settings = new FileBackedSettings({
      load: () => bytes,
      save: (value) => { bytes = value; },
    });
    const saved = settings.save({ version: 1, commitLimit: 500, includeRemotes: false, theme: "dark" });

    expect(saved).toEqual({ version: 1, commitLimit: 500, includeRemotes: false, theme: "dark" });
    expect(settings.load()).toEqual(saved);
    expect(new TextDecoder().decode(bytes)).toBe('{"version":1,"commitLimit":500,"includeRemotes":false,"theme":"dark"}');
  });

  it("bounds settings and rejects unknown schema revisions", () => {
    expect(parseSettings('{"version":1,"commitLimit":9,"includeRemotes":true,"theme":"system"}')).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ version: 2, commitLimit: 50, includeRemotes: true, theme: "light" })).toEqual(DEFAULT_SETTINGS);
  });
});
