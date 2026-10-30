import { encodeToolRun, type ToolRun } from "@commits/ipc/native";

/** One side of a diff, as Git handed it over. */
export interface ToolDiffSide {
  /** The path inside the repository, used to name the temporary file. */
  path: string;
  /** The file's bytes at that revision. */
  content: Uint8Array;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encodes bytes as base64.
 *
 * Written out rather than reached for through `btoa` or Node's Buffer: the
 * adapter runs as a WebAssembly component, where neither is guaranteed, and a
 * diff side is arbitrary bytes rather than text that could travel as a string.
 */
export function toBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const remaining = bytes.length - index;
    encoded +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      (remaining > 1 ? BASE64_ALPHABET[(chunk >> 6) & 63] : "=") +
      (remaining > 2 ? BASE64_ALPHABET[chunk & 63] : "=");
  }
  return encoded;
}

/**
 * The file name a diff side is written under.
 *
 * Both sides keep the file's own name -- the host gives each its own directory
 * -- because a diff tool puts the file name in its window title and its
 * heading, and "a.ts" against "a.ts" is what the user is actually comparing.
 */
export function diffSideName(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name === "" ? "file" : name;
}

/**
 * Builds the run the host is asked to perform.
 *
 * Both diff sides travel with it, so the host writes them and resolves the
 * `{left}` and `{right}` placeholders itself; a run without them is an
 * ordinary launch, such as opening a repository.
 */
export function buildToolRun(
  program: string,
  args: readonly string[],
  diff?: { left: ToolDiffSide; right: ToolDiffSide },
): string {
  const run: ToolRun = { program, args: [...args] };
  if (diff !== undefined) {
    run.left = { name: diffSideName(diff.left.path), base64: toBase64(diff.left.content) };
    run.right = { name: diffSideName(diff.right.path), base64: toBase64(diff.right.content) };
  }
  return encodeToolRun(run);
}

/** Reads one revision of one file, the two sides a diff tool is handed. */
export function gitShowArgs(hash: string, path: string): string[] {
  return ["show", `${hash}:${path}`];
}
