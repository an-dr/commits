import type {
  GitFileChange,
  GitFileChangeType,
  QueryResult
} from "@an-dr/commits-core/backend/types";
import type { SimpleGit } from "simple-git";

const eolRegex = /\r\n|\r|\n/g;

type CommitComparisonInput = {
  fromHash: string;
  toHash: string;
};

function toPath(str: string) {
  return str.replace(/\\/g, "/");
}

/**
 * The files that differ between two commits, in the same shape a single
 * commit's changes take, so the panel can render either from one code path.
 */
export async function commitComparison(
  git: SimpleGit,
  input: CommitComparisonInput
): Promise<QueryResult<"commitComparison">> {
  const args = ["--name-status", "-r", "--find-renames", "--diff-filter=AMDR"];
  try {
    const [nameStatus, numStat] = await Promise.all([
      git.raw(["diff", ...args, input.fromHash, input.toHash]),
      git.raw(["diff", "--numstat", "-r", "--find-renames", input.fromHash, input.toHash])
    ]);

    const fileChanges: GitFileChange[] = [];
    const lookup: { [file: string]: number } = {};
    for (const line of nameStatus.split(eolRegex)) {
      const parts = line.split("\t");
      if (parts.length < 2) {
        continue;
      }
      const oldFilePath = toPath(parts[1]);
      const newFilePath = toPath(parts[parts.length - 1]);
      lookup[newFilePath] = fileChanges.length;
      fileChanges.push({
        oldFilePath,
        newFilePath,
        type: parts[0][0] as GitFileChangeType,
        additions: null,
        deletions: null
      });
    }

    for (const line of numStat.split(eolRegex)) {
      const parts = line.split("\t");
      if (parts.length !== 3) {
        continue;
      }
      // A rename is printed as "old => new" or "dir/{old => new}"; both reduce
      // to the new path, which is how the change is keyed above.
      const fileName = toPath(
        parts[2].replace(/(.*){.* => (.*)}/, "$1$2").replace(/.* => (.*)/, "$1")
      );
      const index = lookup[fileName];
      if (typeof index === "number") {
        fileChanges[index].additions = parseInt(parts[0]);
        fileChanges[index].deletions = parseInt(parts[1]);
      }
    }

    return { fileChanges, error: null };
  } catch (error) {
    return { fileChanges: [], error: error instanceof Error ? error.message : String(error) };
  }
}
