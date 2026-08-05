import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("standalone startup ordering", () => {
  it("BUG: imports the shared graph before settings initialize viewState", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const importStarted = source.indexOf("const imports = Promise.all([");
    const viewStateInitialized = source.indexOf("globalThis.viewState = createViewState(initialSettings);");

    expect(importStarted).toBeGreaterThan(-1);
    expect(viewStateInitialized).toBeGreaterThan(-1);
    expect(importStarted).toBeLessThan(viewStateInitialized);
  });
});
