import type { ActionPayload } from "@an-dr/commits-core/backend/types";
import type { SimpleGit } from "simple-git";

export async function checkoutCommit(
  git: SimpleGit,
  input: ActionPayload<"checkoutCommit">
): Promise<void> {
  await git.checkout(input.commitHash);
}

export async function cherrypickCommit(
  git: SimpleGit,
  input: ActionPayload<"cherrypickCommit">
): Promise<void> {
  const args = ["cherry-pick"];
  if (input.parentIndex > 0) {
    args.push("-m", String(input.parentIndex));
  }
  args.push(input.commitHash);
  await git.raw(args);
}

export async function revertCommit(
  git: SimpleGit,
  input: ActionPayload<"revertCommit">
): Promise<void> {
  const args = ["revert", "--no-edit"];
  if (input.parentIndex > 0) {
    args.push("-m", String(input.parentIndex));
  }
  args.push(input.commitHash);
  await git.raw(args);
}

/**
 * Replays the current branch onto a commit. `--ignore-date` rewrites the
 * author dates to the replay time, which is what makes the rewritten commits
 * sit in date order with the ones they now follow.
 */
export async function rebase(git: SimpleGit, input: ActionPayload<"rebase">): Promise<void> {
  const args = ["rebase", input.commitHash];
  if (input.ignoreDate) {
    args.push("--ignore-date");
  }
  await git.raw(args);
}

export async function resetToCommit(
  git: SimpleGit,
  input: ActionPayload<"resetToCommit">
): Promise<void> {
  await git.raw(["reset", "--" + input.resetMode, input.commitHash]);
}
