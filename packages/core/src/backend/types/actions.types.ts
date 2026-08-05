import type { GitResetMode } from "./git.types";

export type GitCommandStatus = string | null;

type ActionPayloads = {
  addTag: { tagName: string; commitHash: string; lightweight: boolean; message: string };
  checkoutBranch: { branchName: string; remoteBranch: string | null };
  checkoutCommit: { commitHash: string };
  cherrypickCommit: { commitHash: string; parentIndex: number };
  createBranch: { commitHash: string; branchName: string };
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
  mergeBranch: { branchName: string; createNewCommit: boolean };
  mergeCommit: { commitHash: string; createNewCommit: boolean };
  pushTag: { tagName: string };
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
