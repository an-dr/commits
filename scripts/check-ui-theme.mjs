import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../packages/webview-shell/assets/main.css", import.meta.url), "utf8");
const dropdown = await readFile(new URL("../packages/webview-shell/assets/dropdown.css", import.meta.url), "utf8");
const theme = await readFile(new URL("../ui/src/standalone-theme.css", import.meta.url), "utf8");
const referenced = new Set([...`${main}\n${dropdown}`.matchAll(/var\((--vscode-[A-Za-z0-9-]+)/g)].map((match) => match[1]));
const defined = new Set([...theme.matchAll(/(--vscode-[A-Za-z0-9-]+)\s*:/g)].map((match) => match[1]));
const missing = [...referenced].filter((variable) => !defined.has(variable)).sort();
if (missing.length > 0) {
  throw new Error(`Standalone theme does not define shared view variables:\n${missing.join("\n")}`);
}
