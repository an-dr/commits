import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@commits/adapter/read/settings";
import { createViewState } from "./settings";

describe("standalone settings bridge", () => {
  it("maps extension keys into the shared view before it mounts", () => {
    const state = createViewState({
      ...DEFAULT_SETTINGS,
      core: {
        ...DEFAULT_SETTINGS.core,
        "an-dr-com-mit-s.uiDensity": "Compact",
        "an-dr-com-mit-s.keyboardShortcut.refresh": "UNASSIGNED",
        "an-dr-com-mit-s.initialLoadCommits": 900,
      },
    });

    expect(state).toMatchObject({ uiDensity: "Compact", refreshShortcutKey: null, initialLoadCommits: 900 });
  });
});
