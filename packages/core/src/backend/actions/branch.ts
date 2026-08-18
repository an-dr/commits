import type { ActionPayload } from "@an-dr/commits-core/backend/types";
import type { SimpleGit } from "simple-git";

/** Creates a branch at a commit, or repoints an existing one when forced. */
export async function createBranch(
  git: SimpleGit,
  input: ActionPayload<"createBranch">
): Promise<void> {
  const args = ["branch"];
  if (input.force) {
    args.push("-f");
  }
  args.push(input.branchName, input.commitHash);
  await git.raw(args);
}

export async function deleteBranch(
  git: SimpleGit,
  input: ActionPayload<"deleteBranch">
): Promise<void> {
  await git.deleteLocalBranch(input.branchName, input.forceDelete);
}

export async function renameBranch(
  git: SimpleGit,
  input: ActionPayload<"renameBranch">
): Promise<void> {
  await git.raw(["branch", "-m", input.oldName, input.newName]);
}

export async function checkoutBranch(
  git: SimpleGit,
  input: ActionPayload<"checkoutBranch">
): Promise<void> {
  if (input.remoteBranch === null) {
    await git.checkout(input.branchName);
  } else {
    await git.checkoutBranch(input.branchName, input.remoteBranch);
  }
}
