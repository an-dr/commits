import type { GitCommitNode } from "@an-dr/commits-core/backend/types";

/**
 * Projects a commit list onto the rows a filter leaves visible.
 *
 * The graph is drawn against row offsets, so once rows are hidden its vertices
 * no longer line up with what is on screen. Rather than remap the finished
 * layout, the graph is rebuilt over the visible commits alone, with each one
 * reconnected to its nearest visible ancestors. An edge that had to pass
 * through hidden commits to find one is reported as bridged, so it can be drawn
 * dashed and the reader can see history was skipped.
 */

/** A commit list reduced to visible rows, with parents reconnected. */
export interface FilteredGraph {
  /** The visible commits, in their original order. */
  readonly commits: GitCommitNode[];
  /** Row index of each visible commit, by hash. */
  readonly lookup: { [hash: string]: number };
  /**
   * Hashes of the parents each visible commit reaches only by skipping hidden
   * commits, keyed by the child's hash.
   */
  readonly bridged: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Walks the ancestry of `hashes` until it reaches commits that are visible,
 * so a filtered row still connects to the history it descends from.
 *
 * Commits absent from the list entirely -- history not loaded yet -- end the
 * walk rather than extending it, because nothing is known about their parents.
 */
function nearestVisibleAncestors(
  origin: string,
  hashes: readonly string[],
  visible: ReadonlySet<string>,
  byHash: ReadonlyMap<string, GitCommitNode>
): { reached: string[]; bridged: boolean } {
  const reached: string[] = [];
  // Seeded with the commit itself: history that loops back through hidden
  // commits must not reconnect a vertex to its own row.
  const seen = new Set<string>([origin]);
  const queue = [...hashes];
  let bridged = false;
  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (seen.has(hash)) {
      continue;
    }
    seen.add(hash);
    if (visible.has(hash)) {
      reached.push(hash);
      continue;
    }
    const commit = byHash.get(hash);
    if (commit === undefined) {
      continue;
    }
    // Reaching past a hidden commit is what makes the edge a bridge.
    bridged = true;
    queue.push(...commit.parentHashes);
  }
  return { reached, bridged };
}

/**
 * Rebuilds the commit list for the graph from the rows a filter leaves.
 *
 * `isVisible` is asked once per commit, in row order, so the caller decides
 * what matching means.
 */
export function filterGraph(
  commits: readonly GitCommitNode[],
  isVisible: (commit: GitCommitNode, index: number) => boolean
): FilteredGraph {
  const visibleCommits = commits.filter((commit, index) => isVisible(commit, index));
  const visible = new Set(visibleCommits.map((commit) => commit.hash));
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const lookup: { [hash: string]: number } = {};
  const bridged = new Map<string, Set<string>>();

  const projected = visibleCommits.map((commit, index) => {
    lookup[commit.hash] = index;
    const { reached, bridged: viaHidden } = nearestVisibleAncestors(
      commit.hash,
      commit.parentHashes,
      visible,
      byHash
    );
    if (viaHidden) {
      // Only the parents that were not already direct are drawn as bridges.
      const direct = new Set(commit.parentHashes);
      const skipped = reached.filter((hash) => !direct.has(hash));
      if (skipped.length > 0) {
        bridged.set(commit.hash, new Set(skipped));
      }
    }
    return { ...commit, parentHashes: reached };
  });

  return { commits: projected, lookup, bridged };
}
