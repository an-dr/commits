import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const extensionDirectory = process.argv[2] ?? process.env.COMMITS_VSC_EXTENSION;
if (!extensionDirectory) {
  throw new Error("usage: npm run check:settings-compat -- <VSCode Commits directory>");
}

const manifest = JSON.parse(await readFile(path.join(extensionDirectory, "package.json"), "utf8"));
const declared = manifest?.contributes?.configuration?.properties;
if (typeof declared !== "object" || declared === null) {
  throw new Error("extension package.json has no contributes.configuration.properties");
}
// Settings are matched by name: the extension may still publish them under
// its old an-dr-com-mit-s prefix, while Commits uses commits and commits-vsc.
const settingName = (key) => key.replace(/^(an-dr-com-mit-s|commits|commits-vsc)\./, "");
const properties = Object.fromEntries(Object.entries(declared).map(([key, value]) => [settingName(key), value]));

const entry = path.resolve("apps/commits/bones-adapter/src/read/settings.ts");
const bundle = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", write: false });
const source = bundle.outputFiles[0]?.text;
if (!source) throw new Error("could not bundle the standalone settings catalog");
const catalogModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const catalog = catalogModule.CORE_SETTING_DEFINITIONS;
const failures = [];

if (catalog.length !== Object.keys(properties).length) {
  failures.push(`setting count differs: standalone ${catalog.length}, extension ${Object.keys(properties).length}`);
}
for (const definition of catalog) {
  const property = properties[settingName(definition.key)];
  if (property === undefined) {
    failures.push(`${definition.key}: missing from extension`);
    continue;
  }
  const expectedKind = property.type === "array" ? "colours"
    : property.type === "object" ? "columns"
      : property.type;
  if (definition.kind !== expectedKind) failures.push(`${definition.key}: kind differs`);
  if (JSON.stringify(definition.defaultValue) !== JSON.stringify(property.default)) {
    failures.push(`${definition.key}: default differs`);
  }
  if (JSON.stringify(definition.options) !== JSON.stringify(property.enum)) {
    failures.push(`${definition.key}: enum differs`);
  }
}
for (const name of Object.keys(properties)) {
  if (!catalog.some((definition) => settingName(definition.key) === name)) failures.push(`${name}: missing from standalone`);
}

const colours = properties.graphColours;
const colourPattern = "^\\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgb[a]?\\s*\\(\\d{1,3},\\s*\\d{1,3},\\s*\\d{1,3}\\))\\s*$";
if (colours?.items?.type !== "string" || colours.items.pattern !== colourPattern) {
  failures.push("graphColours: item schema differs");
}

const columns = properties["repository.commits.columnVisibility"];
const columnNames = Object.keys(columns?.properties ?? {}).sort();
const booleanColumns = columnNames.every((name) => columns.properties[name]?.type === "boolean");
if (JSON.stringify(columnNames) !== JSON.stringify(["Committed", "ID"])
  || !booleanColumns || columns?.additionalProperties !== false) {
  failures.push("repository.commits.columnVisibility: property schema differs");
}

if (failures.length > 0) throw new Error(`settings catalogs differ:\n${failures.join("\n")}`);
console.log(`Settings catalog matches ${catalog.length} declarations in ${pathToFileURL(extensionDirectory)}.`);
