import { execFile } from "node:child_process";

import type { RepoInProgressType } from "@an-dr/commits-core/backend/queries/repoInProgress";

export type InProgressAction = "continue" | "abort";
export type InProgressGitRunner = (
  gitPath: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<void>;

const COMMANDS: Record<RepoInProgressType, string> = {
  rebase: "rebase",
  merge: "merge",
  "cherry-pick": "cherry-pick",
  revert: "revert"
};

/** Default runner: spawns Git directly, resolving only on a zero exit. */
function executeGit(
  gitPath: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(gitPath, args, options, (error) => (error === null ? resolve() : reject(error)));
  });
}

/**
 * Continues or aborts the Git operation currently owning the working tree.
 * The editor variables keep the sequencer non-interactive so the call cannot hang.
 */
export async function runInProgressOperation(
  gitPath: string,
  repo: string,
  type: RepoInProgressType,
  action: InProgressAction,
  run: InProgressGitRunner = executeGit
): Promise<void> {
  await run(gitPath, [COMMANDS[type], `--${action}`], {
    cwd: repo,
    env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" }
  });
}
