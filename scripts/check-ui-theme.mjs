import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../ui/src/main.css", import.meta.url), "utf8");
const theme = await readFile(new URL("../ui/src/theme.css", import.meta.url), "utf8");
if (/--vscode-/i.test(`${css}\n${theme}`)) {
  throw new Error("Standalone UI must not depend on VS Code CSS variables.");
}
