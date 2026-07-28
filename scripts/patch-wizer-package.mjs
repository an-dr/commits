import { readFile, writeFile } from "node:fs/promises";

const helper = new URL(
  "../node_modules/@bytecodealliance/wizer/package-helpers.js",
  import.meta.url,
);
const source = await readFile(helper, "utf8");
const entry =
  '    "win32 arm64 LE": "@commits/wizer-win32-arm64",\n';

if (!source.includes(entry)) {
  const marker = "const knownPackages = {\n";
  if (!source.includes(marker)) {
    throw new Error("Unrecognized @bytecodealliance/wizer package helper");
  }
  await writeFile(helper, source.replace(marker, marker + entry));
}

