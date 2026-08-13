/** Matches one `git submodule status [--recursive]` line: a status char, the
 * commit hash, the path, and an optional `(describe)` suffix this ignores. */
const SUBMODULE_STATUS_LINE = /^.[0-9a-f]{4,40}\s+(\S+)/;

/**
 * Parses `git submodule status --recursive` output into repository-root
 * relative paths. `--recursive` already walks into each submodule's own
 * `.gitmodules`, so the result includes submodules of submodules with their
 * full path from the root (e.g. `vendor/bones/vendor/pubsub-bus`).
 */
export function parseSubmodulePaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    const match = SUBMODULE_STATUS_LINE.exec(line);
    if (match !== null) paths.push(match[1]);
  }
  return paths;
}
