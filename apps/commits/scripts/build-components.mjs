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
    witPath: filePath(new URL("vendor/bones/wit/core.wit", root)),
    worldName: "extension",
  };
  if (wizerPath !== undefined) options.wizerBin = wizerPath;
  const result = await componentize(bundled.outputFiles[0].text, options);
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
