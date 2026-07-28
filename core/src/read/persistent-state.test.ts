import { describe, expect, it } from "vitest";
import { FileBackedSettings } from "./settings";
import { DEFAULT_PERSISTENT_STATE, PersistentExtensionState } from "./persistent-state";

describe("PersistentExtensionState", () => {
  it("survives a component restart and retains settings in the shared file", () => {
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const storage = { load: () => bytes, save: (value: Uint8Array<ArrayBufferLike>) => { bytes = value; } };
    const settings = new FileBackedSettings(storage);
    settings.save({ version: 1, commitLimit: 100, includeRemotes: true, theme: "light" });
    const first = new PersistentExtensionState(storage);
    first.save({
      version: 1, lastActiveRepository: "C:/repo", selectedCommit: "a1b2",
      find: "fix", findIsCaseSensitive: true, findIsRegex: false,
    });

    const restarted = new PersistentExtensionState(storage);
    expect(restarted.load()).toMatchObject({ lastActiveRepository: "C:/repo", selectedCommit: "a1b2", find: "fix" });
    expect(new FileBackedSettings(storage).load()).toMatchObject({ commitLimit: 100, theme: "light" });
  });

  it("fails closed for invalid persisted state", () => {
    const state = new PersistentExtensionState({
      load: () => new TextEncoder().encode('{"state":{"version":1,"find":true}}'),
      save: () => undefined,
    });
    expect(state.load()).toEqual(DEFAULT_PERSISTENT_STATE);
  });
});
