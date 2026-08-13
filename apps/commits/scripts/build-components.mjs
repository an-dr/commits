import { access, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { arch, platform } from "node:process";

const root = new URL("../../../", import.meta.url);
const localWizer = new URL(".tools/wizer/bin/wizer.exe", root);
await mkdir(new URL("dist/extensions/", root), { recursive: true });
const wizerPath = await resolveWizerPath();
await buildComponent("apps/commits/bones-adapter/src/component.ts", "dist/extensions/commits.wasm", wizerPath);
await buildComponent("apps/commits/bones-adapter/src/hello.ts", "dist/extensions/hello.wasm", wizerPath);

async function resolveWizerPath() {
  if (platform !== "win32" || arch !== "arm64") {
    return undefined;
  }
  try {
    await access(localWizer);
    return filePath(localWizer);
  } catch {
    // Not installed yet -- fall through and build it below.
  }
  // cargo install can report a non-zero exit here even after printing
  // "Installed package" and placing the binary (observed on the win-arm64
  // runner), so status alone is not a reliable success signal. Install,
  // then check for the binary itself, and only fail if it is missing.
  run("cargo", [
    "install",
    "wizer",
    "--version",
    "10.0.0",
    "--locked",
    "--features",
    "env_logger,structopt",
    "--root",
    ".tools/wizer",
  ]);
  await access(localWizer);
  return filePath(localWizer);
}

async function buildComponent(source, output, wizerPath) {
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
  const options = {
    disableFeatures: ["stdio", "random", "clocks", "http", "fetch-event"],
    sourceName: `${basename(source, ".ts")}.js`,
    witPath: filePath(new URL("vendor/bones/wit/extension.wit", root)),
    worldName: "extension",
  };
  if (wizerPath !== undefined) options.wizerBin = wizerPath;
  const result = await componentize(bundled.outputFiles[0].text, options);
  await writeFile(new URL(output, root), result.component);
  console.log(`OK Successfully written ${output}.`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: filePath(root), stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    // Not thrown here: callers that only care about a produced artifact
    // (e.g. resolveWizerPath) check for it themselves, since this status
    // has been observed non-zero on a run that otherwise fully succeeded.
    console.warn(`warning: ${command} exited with status ${result.status} (signal ${result.signal})`);
  }
}

function filePath(url) {
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
}
