import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("standalone startup ordering", () => {
  it("initializes viewState before importing the shared graph", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const importStarted = source.indexOf("const [{ setWebviewHost }, { startCommitsView }] = await Promise.all([");
    const viewStateInitialized = source.indexOf("globalThis.viewState = createViewState(initialSettings);");

    expect(importStarted).toBeGreaterThan(-1);
    expect(viewStateInitialized).toBeGreaterThan(-1);
    expect(viewStateInitialized).toBeLessThan(importStarted);
  });
});
