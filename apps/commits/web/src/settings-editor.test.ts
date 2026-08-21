import { describe, expect, it } from "vitest";
import { formatSettingLabel, readArgumentLines } from "./settings-editor";

describe("readArgumentLines", () => {
  it("takes one argument per line, which needs no quoting rule", () => {
    expect(readArgumentLines("--diff\n{left}\n{right}")).toEqual(["--diff", "{left}", "{right}"]);
  });

  it("keeps an argument containing spaces as one argument", () => {
    expect(readArgumentLines("--flag\nC:/Program Files/app")).toEqual([
      "--flag",
      "C:/Program Files/app",
    ]);
  });

  it("drops blank lines rather than passing empty arguments to the program", () => {
    expect(readArgumentLines("\n{repo}\n\n  \n")).toEqual(["{repo}"]);
    expect(readArgumentLines("")).toEqual([]);
  });
});

describe("settings editor", () => {
  it("turns exact compatibility keys into readable labels", () => {
    expect(formatSettingLabel("an-dr-com-mit-s.branchPanel.groupsFirst"))
      .toBe("Branch Panel · Groups First");
  });
});
