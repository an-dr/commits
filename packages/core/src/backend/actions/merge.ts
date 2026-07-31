import type { ActionPayload } from "@an-dr/commits-core/backend/types";
import type { SimpleGit } from "simple-git";

export async function mergeBranch(
  git: SimpleGit,
  input: ActionPayload<"mergeBranch">
): Promise<void> {
  const args = input.createNewCommit ? [input.branchName, "--no-ff"] : [input.branchName];
  await git.merge(args);
}

export async function mergeCommit(
  git: SimpleGit,
  input: ActionPayload<"mergeCommit">
): Promise<void> {
  const args = input.createNewCommit ? [input.commitHash, "--no-ff"] : [input.commitHash];
  await git.merge(args);
}
