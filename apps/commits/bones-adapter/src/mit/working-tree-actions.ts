import type { GitResult, GitRun } from "@commits/ipc/native";

interface GitHost {
  runGit(request: GitRun): void;
}

/** What the view asks to be done to the working tree. */
export type WorkingTreeAction =
  | { readonly command: "stageFiles"; readonly files: readonly string[] }
  | { readonly command: "unstageFiles"; readonly files: readonly string[] }
  | {
      readonly command: "discardFiles";
      readonly files: readonly string[];
      readonly untracked: boolean;
    };

/** Failure text of a Git run, preferring what Git itself said. */
function failureText(result: GitResult): string {
  const text = new TextDecoder().decode(result.stderr).trim();
  return (text || new TextDecoder().decode(result.stdout).trim()).split(/\r\n|\r|\n/)[0] ?? "";
}

/**
 * Runs the working-tree mutations the changes panel offers.
 *
 * Each one is a single bounded Git command over an explicit file list, and the
 * files always follow `--`, so a path can never be read as an option. A failure
 * is reported with Git's own words rather than a generic message, because these
 * commands fail for reasons the user has to act on.
 */
export class WorkingTreeActions {
  private nextRequestId = 40_000;
  private readonly pending = new Map<number, (result: GitResult) => void>();

  constructor(private readonly host: GitHost) {}

  receive(result: GitResult): void {
    const callback = this.pending.get(result.requestId);
    if (callback === undefined) return;
    this.pending.delete(result.requestId);
    callback(result);
  }

  /** Runs one action, answering with Git's failure text or null on success. */
  run(repo: string, action: WorkingTreeAction, deliver: (status: string | null) => void): void {
    const files = action.files.filter((file) => file !== "");
    if (repo === "" || files.length === 0) {
      deliver("Nothing to do.");
      return;
    }
    const requestId = this.nextRequestId++;
    this.pending.set(requestId, (result) =>
      deliver(
        result.status === "completed" && result.exitCode === 0
          ? null
          : failureText(result) || "The Git command did not complete.",
      ),
    );
    this.host.runGit({
      requestId,
      cwd: repo,
      args: [...argsFor(action), "--", ...files],
      timeoutMs: 30_000,
    });
  }
}

function argsFor(action: WorkingTreeAction): string[] {
  switch (action.command) {
    case "stageFiles":
      return ["add"];
    case "unstageFiles":
      // `reset` leaves the working tree untouched, which is what unstaging means.
      return ["reset", "--quiet", "HEAD"];
    default:
      // Discarding restores the file from the index, so anything already staged
      // survives; an untracked file has no earlier version, so it is removed.
      return action.untracked ? ["clean", "--quiet", "--force"] : ["checkout", "--quiet"];
  }
}
