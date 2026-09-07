import type { ActionPayload } from "@an-dr/commits-core/backend/types";
import type { SimpleGit } from "simple-git";

export async function pushBranch(
  git: SimpleGit,
  input: ActionPayload<"pushBranch">
): Promise<void> {
  await git.push(input.remote, input.branchName);
}

export async function addRemote(
  git: SimpleGit,
  input: ActionPayload<"addRemote">
): Promise<void> {
  await git.addRemote(input.name, input.url);
}

export async function renameRemote(
  git: SimpleGit,
  input: ActionPayload<"renameRemote">
): Promise<void> {
  await git.raw(["remote", "rename", input.oldName, input.newName]);
}

export async function removeRemote(
  git: SimpleGit,
  input: ActionPayload<"removeRemote">
): Promise<void> {
  await git.removeRemote(input.name);
}

export async function setRemoteUrl(
  git: SimpleGit,
  input: ActionPayload<"setRemoteUrl">
): Promise<void> {
  await git.raw(["remote", "set-url", input.name, input.url]);
}

/** Sets `remote.pushDefault` in local config, so a plain push resolves to it. */
export async function setDefaultRemote(
  git: SimpleGit,
  input: ActionPayload<"setDefaultRemote">
): Promise<void> {
  await git.raw(["config", "remote.pushDefault", input.name]);
}
