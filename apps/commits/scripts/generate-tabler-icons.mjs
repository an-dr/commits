import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const fontPath = new URL(
  "node_modules/@tabler/icons-webfont/dist/fonts/tabler-icons.woff2",
  root
);

/** Icon classes actually used by the app, mapped to their Tabler codepoint. */
const ICONS = {
  "ti-refresh": "\\eb13",
  "ti-history": "\\ebea",
  "ti-download": "\\ea96",
  "ti-arrow-up": "\\ea25"
};

const font = await readFile(fontPath);
const base64 = font.toString("base64");

const rules = Object.entries(ICONS)
  .map(([className, codepoint]) => `.${className}:before{content:"${codepoint}"}`)
  .join("");

const css =
  `@font-face{font-family:"tabler-icons";src:url(data:font/woff2;base64,${base64}) format("woff2");font-weight:400;font-style:normal}` +
  '.ti{font-family:"tabler-icons"!important;font-style:normal;font-weight:400;font-variant:normal;text-transform:none;line-height:1;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
  rules;

// Emitted into dist/ui so generate-page.mjs can inline it the same way it
// inlines page.css; the font itself lives only in node_modules, never in
// source control, since it's a multi-hundred-KB derived asset.
await mkdir(new URL("dist/ui/", root), { recursive: true });
await writeFile(new URL("dist/ui/tabler-icons.css", root), css);
