/** The checked-out revision and upstream state of a repository. */
export interface HeadInfo {
  readonly branchName: string;
  readonly headHash: string | null;
  readonly upstreamRemote: string | null;
  readonly upstreamRef: string | null;
  readonly remoteNames: string[];
}

/** A staged or unstaged working-tree entry. */
export interface GitWorkingTreeChange {
  readonly path: string;
  readonly oldPath?: string;
  /** `C`: unmerged, still holding a conflict. */
  readonly status: "A" | "M" | "D" | "R" | "U" | "C";
  readonly staged: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly submodule: null;
}

/** Working-tree totals used by compact status surfaces. */
export interface GitChangeCounts {
  readonly modified: number;
  readonly deleted: number;
}

/** Authorship of one blamed line. */
export interface BlameLineInfo {
  readonly author: string;
  readonly authorEmail: string;
  readonly authorTime: number;
  readonly committed: boolean;
  readonly hash: string;
  readonly summary: string;
}
