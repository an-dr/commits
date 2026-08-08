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

/** A commit of what is staged, which names no files of its own. */
export interface CommitAction {
  readonly message: string;
  readonly amend: boolean;
}

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
    this.send(repo, [...argsFor(action), "--", ...files], deliver);
  }

  /**
   * Commits what is staged.
   *
   * The message is passed as one argument rather than through an editor, so no
   * editor is ever launched, and an empty message is refused here because Git
   * would otherwise open one.
   */
  commit(repo: string, action: CommitAction, deliver: (status: string | null) => void): void {
    const message = action.message.trim();
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    if (message === "") {
      deliver("A commit needs a message.");
      return;
    }
    this.send(
      repo,
      ["commit", ...(action.amend ? ["--amend"] : []), "--message", message],
      deliver,
    );
  }

  /**
   * Fetches, pulls, or pushes the current branch's configured remote(s).
   * Credential prompts (HTTPS password/PAT, SSH passphrase) are handled by
   * the host process's GIT_ASKPASS/GIT_EDITOR wiring (commits-git's
   * ProcessRunner), the same as every other Git command run through it.
   */
  remoteOperation(repo: string, operation: "fetch" | "pull" | "push", deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    const args = operation === "fetch" ? ["fetch", "--all"] : [operation];
    // Network-bound, unlike the local working-tree mutations above -- matches
    // cloneCommitsRepo's own 120s allowance for a remote round trip.
    this.send(repo, args, deliver, 120_000);
  }

  private send(repo: string, args: string[], deliver: (status: string | null) => void, timeoutMs = 30_000): void {
    const requestId = this.nextRequestId++;
    this.pending.set(requestId, (result) =>
      deliver(
        result.status === "completed" && result.exitCode === 0
          ? null
          : failureText(result) || "The Git command did not complete.",
      ),
    );
    this.host.runGit({ requestId, cwd: repo, args, timeoutMs });
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
