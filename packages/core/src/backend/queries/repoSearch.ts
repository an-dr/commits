import { searchDirectoryForRepos } from "@an-dr/commits-core/backend/utils/repoSearch";

export async function findGitRepos(
  paths: string[],
  gitPath: string,
  maxDepth: number
): Promise<string[]> {
  const results = await Promise.all(
    paths.map((p) => searchDirectoryForRepos(p, maxDepth, gitPath, []))
  );
  return results.flat();
}
