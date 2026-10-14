import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraphShell } from "@an-dr/commits-webview-shell/shell";
import { WEBVIEW } from "./webview-contract";

/** Source of a file this contract depends on, read relative to this test. */
const source = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("webview contract", () => {
  const shell = buildGraphShell((message) => message);
  const graph = source("../../../../packages/core/src/webview/main.ts");
  const dropdown = source("../../../../packages/core/src/webview/dropdown.ts");
  const page = source("./main.ts");

  it("finds the shell's mount points", () => {
    for (const id of [WEBVIEW.controlsId, WEBVIEW.activityStatusId, WEBVIEW.viewId, "repoSelect"]) {
      expect(shell, id).toContain(`id="${id}"`);
    }
  });

  it("finds the repository dropdown's parts", () => {
    expect(WEBVIEW.repositoryMenu).toBe("#repoSelect .dropdownMenu");
    expect(WEBVIEW.repositoryMenuToggle).toBe("#repoSelect .dropdownCurrentValue");
    expect(dropdown).toContain('className = "dropdownMenu"');
    expect(dropdown).toContain('className = "dropdownCurrentValue"');
  });

  it("finds the graph rows navigation selects", () => {
    expect(graph).toContain('class="unsavedChanges"');
    expect(graph).toContain('data-hash="');
    expect(graph).toContain('<span class="description"');
  });

  it("finds this app's own menu entries and recent list", () => {
    expect(page).toContain(`id="${WEBVIEW.recentRepositoriesId}"`);
    for (const selector of WEBVIEW.sourceRefreshTriggers.split(", ").filter((selector) => selector !== "#repoSelect")) {
      expect(page, selector).toContain(`id="${selector.slice(1)}"`);
    }
  });
});
