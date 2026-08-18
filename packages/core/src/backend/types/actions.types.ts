import type { GitResetMode } from "./git.types";

export type GitCommandStatus = string | null;

type ActionPayloads = {
  /** `force` rewrites a tag that already exists, which is how a tag moves. */
  addTag: {
    tagName: string;
    commitHash: string;
    lightweight: boolean;
    message: string;
    force: boolean;
  };
  checkoutBranch: { branchName: string; remoteBranch: string | null };
  checkoutCommit: { commitHash: string };
  cherrypickCommit: { commitHash: string; parentIndex: number };
  /** `force` repoints a branch that already exists, which is how a branch moves. */
  createBranch: { commitHash: string; branchName: string; force: boolean };
  deleteBranch: { branchName: string; forceDelete: boolean };
  deleteTag: { tagName: string };
  /** Moves working-tree files into the index. */
  stageFiles: { files: string[] };
  /** Takes files back out of the index, leaving the working tree alone. */
  unstageFiles: { files: string[] };
  /**
   * Throws away working-tree changes. An untracked file is deleted rather than
   * restored, because Git has no earlier version of it to restore.
   */
  discardFiles: { files: string[]; untracked: boolean };
  /** Commits what is staged, or rewrites the last commit when amending. */
  commitChanges: { message: string; amend: boolean };
  mergeBranch: { branchName: string; createNewCommit: boolean };
  mergeCommit: { commitHash: string; createNewCommit: boolean };
  pushTag: { tagName: string };
  /**
   * Replays the current branch onto a commit. Only the non-interactive form
   * exists: an interactive rebase needs a terminal to edit its todo list in,
   * and the standalone app has none to hand it to.
   */
  rebase: { commitHash: string; ignoreDate: boolean };
  renameBranch: { oldName: string; newName: string };
  resetToCommit: { commitHash: string; resetMode: GitResetMode };
  revertCommit: { commitHash: string; parentIndex: number };
};

export type ActionRequest = {
  [K in keyof ActionPayloads]: { command: K; repo: string } & ActionPayloads[K];
}[keyof ActionPayloads];

export type ActionResponse = {
  [K in keyof ActionPayloads]: { command: K; status: GitCommandStatus };
}[keyof ActionPayloads];

export type ActionPayload<T extends keyof ActionPayloads> = ActionPayloads[T];
