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
 * Runs the working-tree, branch, and tag mutations the changes panel and
 * branch/tag context menus offer.
 *
 * Working-tree actions are a single bounded Git command over an explicit file
 * list, and the files always follow `--`, so a path can never be read as an
 * option. Every action reports Git's own failure words rather than a generic
 * message, because these commands fail for reasons the user has to act on.
 */
export class WorkingTreeActions {
  private nextRequestId = 40_000;
  private readonly pending = new Map<number, (result: GitResult) => void>();

  /**
   * @param onMutated Called with the repository after any action finishes.
   *   Every method here changes the repository, so this is the one place that
   *   knows a cached read of it may no longer be true. It fires on failure
   *   too: a merge that stopped part-way still moved the refs.
   */
  constructor(
    private readonly host: GitHost,
    private readonly onMutated: (repo: string) => void = () => {},
  ) {}

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

  /** Pulls one specific remote branch into the current branch. */
  pullBranch(repo: string, remote: string, branchName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["pull", remote, branchName], deliver, 120_000);
  }

  /** Deletes a branch on its remote. */
  deleteRemoteBranch(repo: string, remote: string, branchName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["push", remote, "--delete", branchName], deliver, 120_000);
  }

  /** Checks out a local branch, or a remote one as a new local branch tracking it. */
  checkoutBranch(repo: string, branchName: string, remoteBranch: string | null, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, remoteBranch === null ? ["checkout", branchName] : ["checkout", "-b", branchName, remoteBranch], deliver);
  }

  renameBranch(repo: string, oldName: string, newName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["branch", "-m", oldName, newName], deliver);
  }

  deleteBranch(repo: string, branchName: string, forceDelete: boolean, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["branch", forceDelete ? "-D" : "-d", branchName], deliver);
  }

  mergeBranch(repo: string, branchName: string, createNewCommit: boolean, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, createNewCommit ? ["merge", branchName, "--no-ff"] : ["merge", branchName], deliver);
  }

  /** Creates a branch at a commit, optionally checking it out in one step. */
  createBranch(
    repo: string,
    branchName: string,
    commitHash: string,
    checkout: boolean,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(
      repo,
      checkout ? ["checkout", "-b", branchName, commitHash] : ["branch", branchName, commitHash],
      deliver,
    );
  }

  /**
   * Carries on or abandons an operation the repository is part-way through.
   *
   * The command is the operation's own name, so a rebase continues with
   * `git rebase --continue` and a cherry-pick with `git cherry-pick --continue`.
   * No `--no-edit` is passed: `--continue` does not accept it, and an editor
   * Git opens is answered by the app's own GIT_EDITOR helper.
   */
  inProgressAction(
    repo: string,
    operationType: "rebase" | "merge" | "cherry-pick" | "revert",
    action: "continue" | "abort",
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, [operationType, `--${action}`], deliver, 120_000);
  }

  /** Moves HEAD onto a commit, leaving the working tree detached there. */
  checkoutCommit(repo: string, commitHash: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["checkout", commitHash], deliver);
  }

  /**
   * Replays a commit onto the current branch. A merge has no single parent to
   * diff against, so `parentIndex` names the side to treat as mainline; it is
   * zero for an ordinary commit, where the option is not allowed at all.
   */
  cherrypickCommit(
    repo: string,
    commitHash: string,
    parentIndex: number,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    const args = ["cherry-pick"];
    if (parentIndex > 0) args.push("-m", String(parentIndex));
    args.push(commitHash);
    this.send(repo, args, deliver);
  }

  /** Undoes a commit with a new one. `--no-edit` keeps Git out of an editor. */
  revertCommit(
    repo: string,
    commitHash: string,
    parentIndex: number,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    const args = ["revert", "--no-edit"];
    if (parentIndex > 0) args.push("-m", String(parentIndex));
    args.push(commitHash);
    this.send(repo, args, deliver);
  }

  /**
   * Moves the current branch to a commit. The mode decides how much goes with
   * it, and "hard" is the one that discards work, so it is never a default.
   */
  resetToCommit(
    repo: string,
    commitHash: string,
    resetMode: "soft" | "mixed" | "hard",
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["reset", `--${resetMode}`, commitHash], deliver);
  }

  /** Merges a commit into the current branch. */
  mergeCommit(
    repo: string,
    commitHash: string,
    createNewCommit: boolean,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(
      repo,
      createNewCommit ? ["merge", commitHash, "--no-ff"] : ["merge", commitHash],
      deliver,
    );
  }

  /**
   * Creates a tag on a commit. An annotated tag carries a message and its own
   * object; a lightweight one is just a ref, and Git rejects `-m` for it, so
   * the two forms cannot share a single argument list.
   */
  addTag(
    repo: string,
    tagName: string,
    commitHash: string,
    lightweight: boolean,
    message: string,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(
      repo,
      lightweight
        ? ["tag", tagName, commitHash]
        : ["tag", "-a", tagName, commitHash, "-m", message],
      deliver,
    );
  }

  deleteTag(repo: string, tagName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["tag", "-d", tagName], deliver);
  }

  /** Pushes one tag to `origin`, the same remote `packages/core`'s own (currently unused) backend targets. */
  pushTag(repo: string, tagName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["push", "origin", tagName], deliver, 120_000);
  }

  private send(repo: string, args: string[], deliver: (status: string | null) => void, timeoutMs = 30_000): void {
    const requestId = this.nextRequestId++;
    this.pending.set(requestId, (result) => {
      this.onMutated(repo);
      deliver(
        result.status === "completed" && result.exitCode === 0
          ? null
          : failureText(result) || "The Git command did not complete.",
      );
    });
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
