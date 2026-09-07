import type { SubmoduleState, SubmoduleView } from "@an-dr/commits-core/types";

/** Matches one `git submodule status [--recursive]` line: the status char, the
 *  commit hash, and everything after it -- the path, plus an optional
 *  `(describe)` suffix that is stripped separately, because a path may itself
 *  contain spaces and only the parenthesised tail is unambiguous. */
const SUBMODULE_STATUS_LINE = /^([ +U-])[0-9a-f]{4,64} (.+)$/;

/** The `(heads/main)` or `(v1.2.0-3-gabc1234)` tail `git submodule status` adds. */
const DESCRIBE_SUFFIX = /\s+\([^()]*\)$/;

/**
 * Reads the leading status character Git puts in front of the hash.
 *
 * Git documents four: a space for a submodule whose checkout matches the
 * commit the parent records, `-` for one that has never been initialized,
 * `+` for one checked out at a different commit than the parent records, and
 * `U` for one with unmerged conflicts. Anything else is read as up to date --
 * an unknown marker is not a reason to tell the user their tree is broken.
 */
function stateFor(marker: string): SubmoduleState {
  switch (marker) {
    case "-":
      return "uninitialized";
    case "+":
      return "outOfDate";
    case "U":
      return "conflicted";
    default:
      return "upToDate";
  }
}

/**
 * Parses `git submodule status --recursive` output into one entry per
 * submodule, with the path relative to the repository root.
 *
 * `--recursive` walks into each initialized submodule's own `.gitmodules`, so
 * the result includes submodules of submodules with their full path from the
 * root (e.g. `vendor/bones/vendor/pubsub-bus`). An uninitialized submodule has
 * no checkout to walk into, so its own nested submodules stay unreported until
 * it is initialized -- which is why the whole status is reread after an update
 * rather than patched in place.
 */
export function parseSubmoduleEntries(stdout: string): SubmoduleView[] {
  const entries: SubmoduleView[] = [];
  for (const line of stdout.split("\n")) {
    const match = SUBMODULE_STATUS_LINE.exec(line.replace(/\r$/, ""));
    if (match === null) continue;
    // Uninitialized and conflicted entries have no describe suffix.
    const path = match[1] === "-" || match[1] === "U"
      ? match[2]
      : match[2].replace(DESCRIBE_SUFFIX, "");
    if (path === "") continue;
    entries.push({ path, state: stateFor(match[1]) });
  }
  return entries;
}
