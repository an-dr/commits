import { describe, expect, it } from "vitest";
import { DEFAULT_PERSISTENT_STATE, MAX_RECENT_REPOSITORIES, PersistentExtensionState } from "./persistent-state";

describe("PersistentExtensionState", () => {
  it("survives a component restart and retains settings in the shared file", () => {
    const storage = storageWith('{"settings":{"version":1,"commitLimit":100,"includeRemotes":true,"theme":"light"}}');
    const first = new PersistentExtensionState(storage);
    first.save({
      version: 1, lastActiveRepository: "C:/repo", selectedCommit: "a1b2",
      find: "fix", findIsCaseSensitive: true, findIsRegex: false,
    });

    const restarted = new PersistentExtensionState(storage);
    expect(restarted.load()).toMatchObject({ lastActiveRepository: "C:/repo", selectedCommit: "a1b2", find: "fix" });
    expect(JSON.parse(new TextDecoder().decode(storage.load())).settings).toMatchObject({ commitLimit: 100, theme: "light" });
  });

  it("fails closed for invalid persisted state", () => {
    const state = new PersistentExtensionState({
      load: () => new TextEncoder().encode('{"state":{"version":1,"find":true}}'),
      save: () => undefined,
    });
    expect(state.load()).toEqual(DEFAULT_PERSISTENT_STATE);
  });

  it("loads a save written before recent repositories existed", () => {
    const storage = storageWith(JSON.stringify({
      settings: {},
      state: {
        version: 1,
        lastActiveRepository: "C:/repo",
        selectedCommit: null,
        find: "",
        findIsCaseSensitive: false,
        findIsRegex: false,
      },
    }));
    const state = new PersistentExtensionState(storage).load();

    expect(state.lastActiveRepository).toBe("C:/repo");
    expect(state.recentRepositories).toEqual([]);
  });

  it("drops malformed and duplicate recent entries and bounds the list", () => {
    const recentRepositories = [
      "C:/a", "C:/a", 7, "", ...Array.from({ length: 12 }, (_, index) => `C:/r${index}`),
    ];
    const storage = storageWith(JSON.stringify({
      settings: {},
      state: {
        version: 1,
        lastActiveRepository: null,
        recentRepositories,
        selectedCommit: null,
        find: "",
        findIsCaseSensitive: false,
        findIsRegex: false,
      },
    }));
    const state = new PersistentExtensionState(storage).load();

    expect(state.recentRepositories.length).toBe(MAX_RECENT_REPOSITORIES);
    expect(state.recentRepositories[0]).toBe("C:/a");
    expect(new Set(state.recentRepositories).size).toBe(state.recentRepositories.length);
  });
});

function storageWith(document: string) {
  let bytes: Uint8Array<ArrayBufferLike> = new TextEncoder().encode(document);
  return {
    load: () => bytes,
    save: (value: Uint8Array<ArrayBufferLike>) => { bytes = value; },
  };
}
