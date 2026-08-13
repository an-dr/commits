import { access, mkdir, writeFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { arch, platform } from "node:process";

const root = new URL("../../../", import.meta.url);
const localWizer = new URL(".tools/wizer/bin/wizer.exe", root);

/**
 * Says what this script is about to do, on its own line.
 *
 * This exists because of how this step fails when it fails: on the win-arm64
 * runner it has died with exit code 1 and no output whatsoever -- no stack, no
 * npm error block -- which leaves nothing to debug from. A line before each
 * phase means the last line printed names the phase that died, even when the
 * process leaves no words of its own.
 */
function step(message) {
  console.log(`build-components: ${message}`);
}

/**
 * Writes straight to the stderr file descriptor, bypassing `console`.
 *
 * componentize-js spawns wizer with the parent's own stdout *stream* as the
 * child's stdout (`stdio: [null, stdout, "pipe"]`). Once spawnSync has taken
 * that stream over, anything written through `console` afterwards can be
 * lost -- which is exactly how a failure here has been reaching CI: exit code
 * 1, and not one word about why. fd 2 is still ours.
 */
function report(message) {
  writeSync(2, `build-components: ${message}
`);
}

step(`node ${process.version} on ${platform} ${arch}`);
await mkdir(new URL("dist/extensions/", root), { recursive: true });
const wizerPath = await resolveWizerPath();
step(wizerPath === undefined ? "using componentize's own wizer" : `using wizer at ${wizerPath}`);
// Anything componentize-js throws would otherwise vanish with the stdout it
// borrowed, so it is caught here and written to fd 2 by hand.
process.on("unhandledRejection", (error) => {
  report(`unhandled rejection: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
await buildComponent("apps/commits/bones-adapter/src/component.ts", "dist/extensions/commits.wasm", wizerPath);
await buildComponent("apps/commits/bones-adapter/src/hello.ts", "dist/extensions/hello.wasm", wizerPath);

async function resolveWizerPath() {
  if (platform !== "win32" || arch !== "arm64") {
    return undefined;
  }
  try {
    await access(localWizer);
    step("found the bootstrapped wizer, skipping cargo install");
    return filePath(localWizer);
  } catch {
    // Not installed yet -- fall through and build it below.
  }
  step("no local wizer; building it with cargo install (several minutes)");
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
  step("cargo install returned; checking for the binary it should have placed");
  await access(localWizer);
  const path = filePath(localWizer);
  // Proves the binary actually runs here before componentize-js spawns it
  // somewhere its failure would be invisible.
  const probe = spawnSync(path, ["--version"], { encoding: "utf8" });
  report(
    `wizer --version: status=${probe.status} signal=${probe.signal} ` +
      `error=${probe.error ? probe.error.message : "none"} ` +
      `stdout=${JSON.stringify((probe.stdout ?? "").trim())} ` +
      `stderr=${JSON.stringify((probe.stderr ?? "").trim())}`,
  );
  return path;
}

async function buildComponent(source, output, wizerPath) {
  step(`loading esbuild and componentize-js for ${source}`);
  const { build } = await import("esbuild");
  const { componentize } = await import("@bytecodealliance/componentize-js");
  step(`bundling ${source}`);
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
  step(`componentizing ${source}`);
  let result;
  try {
    result = await componentize(bundled.outputFiles[0].text, options);
  } catch (error) {
    report(`componentize failed for ${source}: ${error instanceof Error ? error.stack : String(error)}`);
    throw error;
  }
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
