import { describe, expect, it } from "vitest";
import { formatSettingLabel } from "./settings-editor";

describe("settings editor", () => {
  it("turns exact compatibility keys into readable labels", () => {
    expect(formatSettingLabel("an-dr-com-mit-s.branchPanel.groupsFirst"))
      .toBe("Branch Panel · Groups First");
  });
});
