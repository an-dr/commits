import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Resolves a repository-relative path to an absolute one. */
const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Mirrors the module aliases declared in tsconfig.json.
 *
 * Vitest resolves through Node rather than TypeScript, so value imports through
 * an alias fail without these entries even when tsc accepts them.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@an-dr\/commits-webview-shell\/assets\/(.*)$/,
        replacement: at("./packages/webview-shell/assets/$1"),
      },
      {
        find: /^@an-dr\/commits-webview-shell\/(.*)$/,
        replacement: at("./packages/webview-shell/src/$1"),
      },
      { find: /^@an-dr\/commits-core\/(.*)$/, replacement: at("./packages/core/src/$1") },
      { find: /^@commits\/adapter\/(.*)$/, replacement: at("./apps/commits/bones-adapter/src/$1") },
      { find: /^@commits\/ipc\/(.*)$/, replacement: at("./ipc/ts/$1") },
    ],
  },
});
