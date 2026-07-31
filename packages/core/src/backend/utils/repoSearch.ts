import * as fs from "node:fs/promises";
import * as path from "node:path";

import { isGitRepository } from "@an-dr/commits-core/backend/utils/git";
import { evalPromises } from "@an-dr/commits-core/backend/utils/promise";

async function isDirectory(directoryPath: string): Promise<boolean> {
  return fs
    .stat(directoryPath)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/** Return true when a directory is a known repository or lies within one. */
function isKnownRepositoryDirectory(directory: string, knownRepoPath: string): boolean {
  const relativePath = path.relative(knownRepoPath, directory);
  return (
    relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..")
  );
}

export async function searchDirectoryForRepos(
  directory: string,
  maxDepth: number,
  gitPath: string,
  knownRepoPaths: string[]
): Promise<string[]> {
  if (knownRepoPaths.some((repoPath) => isKnownRepositoryDirectory(directory, repoPath))) {
    return [];
  }

  const isRepo = await isGitRepository(directory, gitPath);
  if (isRepo) {
    return [directory];
  }

  if (maxDepth <= 0) {
    return [];
  }

  const dirContents = await fs.readdir(directory).catch(() => null);
  if (dirContents === null) {
    return [];
  }

  const dirs: string[] = [];
  for (let i = 0; i < dirContents.length; i++) {
    const childDirectory = path.join(directory, dirContents[i]);
    // Deliberately sequential: the search is concurrency-limited on purpose
    // (see evalPromises below), and statting every entry at once would defeat
    // that on a large tree.
    // eslint-disable-next-line no-await-in-loop
    if (dirContents[i] !== ".git" && (await isDirectory(childDirectory))) {
      dirs.push(childDirectory);
    }
  }

  const results = await evalPromises(dirs, 2, (dir) =>
    searchDirectoryForRepos(dir, maxDepth - 1, gitPath, knownRepoPaths)
  );
  return results.flat();
}
