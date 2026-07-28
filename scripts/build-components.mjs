import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { arch, platform } from "node:process";

const root = new URL("../", import.meta.url);
const localWizer = new URL(".tools/wizer/bin/wizer.exe", root);
const jcoPackage = new URL(
  "node_modules/@bytecodealliance/jco/package.json",
  root,
);
const jcoManifest = JSON.parse(await readFile(jcoPackage, "utf8"));
const jco = new URL(jcoManifest.bin.jco, jcoPackage);

await mkdir(new URL("dist/extensions/", root), { recursive: true });
const wizerPath = await resolveWizerPath();
await buildComponent("core/src/component.ts", "dist/extensions/commits.wasm", wizerPath);
await buildComponent("core/src/hello.ts", "dist/extensions/hello.wasm", wizerPath);

async function resolveWizerPath() {
  if (platform !== "win32" || arch !== "arm64") {
    return undefined;
  }
  try {
    await access(localWizer);
  } catch {
    run("cargo", [
      "install",
      "wizer",
      "--version",
      "10.0.0",
      "--locked",
      "--features",
      "env_logger structopt",
      "--root",
      ".tools/wizer",
    ]);
  }
  return filePath(localWizer);
}

async function buildComponent(source, output, wizerPath) {
  if (wizerPath !== undefined) {
    await buildWithLocalWizer(source, output, wizerPath);
    return;
  }
  run(process.execPath, [
    filePath(jco),
    "componentize",
    source,
    "--wit",
    "vendor/bones/wit/core.wit",
    "-n",
    "extension",
    "--disable",
    "all",
    "-o",
    output,
  ]);
}

async function buildWithLocalWizer(source, output, wizerPath) {
  const { build } = await import("esbuild");
  const { componentize } = await import("@bytecodealliance/componentize-js");
  const bundled = await build({
    absWorkingDir: filePath(root),
    bundle: true,
    entryPoints: [source],
    external: ["bones:*"],
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
  });
  const result = await componentize(bundled.outputFiles[0].text, {
    disableFeatures: ["stdio", "random", "clocks", "http", "fetch-event"],
    sourceName: `${basename(source, ".ts")}.js`,
    witPath: filePath(new URL("vendor/bones/wit/core.wit", root)),
    wizerBin: wizerPath,
    worldName: "extension",
  });
  await writeFile(new URL(output, root), result.component);
  console.log(`OK Successfully written ${output}.`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: filePath(root),
    stdio: "inherit",
    shell: platform === "win32" && command === "cargo",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function filePath(url) {
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
}
