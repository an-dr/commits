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

/**
 * Ceiling for a Git command that may need to reach a remote -- long enough to
 * outlast `commits-askpass`'s own wait (20 minutes, `PROMPT_TIMEOUT` in
 * commits-askpass.rs), covering a GitHub device-flow sign-in approved from
 * its credential prompt. Shorter than that would let this timeout fire and
 * kill the outer Git process first, orphaning the askpass helper still
 * waiting underneath it -- reparented to init, answered by nothing.
 */
const NETWORK_TIMEOUT_MS = 1_200_000;

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
    this.send(repo, args, deliver, NETWORK_TIMEOUT_MS);
  }

  /**
   * Initializes and checks out every submodule, recursively.
   *
   * `--init` is what makes this one command rather than two, and `--recursive`
   * is what makes it complete: a submodule that was never initialized hides
   * its own submodules until it exists, so anything short of a recursive
   * update leaves a tree that still needs another pass.
   *
   * Timed like the network operations above, because it is one: an
   * uninitialized submodule has to be cloned before it can be checked out.
   */
  updateSubmodules(repo: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["submodule", "update", "--init", "--recursive"], deliver, NETWORK_TIMEOUT_MS);
  }

  /** Pulls one specific remote branch into the current branch. */
  pullBranch(repo: string, remote: string, branchName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["pull", remote, branchName], deliver, NETWORK_TIMEOUT_MS);
  }

  /** Deletes a branch on its remote. */
  deleteRemoteBranch(repo: string, remote: string, branchName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["push", remote, "--delete", branchName], deliver, NETWORK_TIMEOUT_MS);
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

  /**
   * Creates a branch at a commit, optionally checking it out in one step.
   *
   * `force` repoints a branch that already exists, which is how the graph
   * moves one; it has no bearing on the checkout form, where `-b` would fail
   * on an existing branch for a reason force cannot fix.
   */
  createBranch(
    repo: string,
    branchName: string,
    commitHash: string,
    checkout: boolean,
    force: boolean,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    if (checkout) {
      this.send(repo, ["checkout", "-b", branchName, commitHash], deliver);
      return;
    }
    const args = ["branch"];
    if (force) args.push("-f");
    args.push(branchName, commitHash);
    this.send(repo, args, deliver);
  }

  /**
   * Replays the current branch onto a commit.
   *
   * Only the non-interactive form exists: an interactive rebase needs a
   * terminal to edit its todo list in, and the app has none to hand it to. A
   * rebase can stop on a conflict and take a while doing it, so it gets the
   * long timeout the other history-rewriting commands use.
   */
  rebase(
    repo: string,
    commitHash: string,
    ignoreDate: boolean,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    const args = ["rebase", commitHash];
    if (ignoreDate) args.push("--ignore-date");
    this.send(repo, args, deliver, 120_000);
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
    force: boolean,
    deliver: (status: string | null) => void,
  ): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    const args = ["tag"];
    if (force) args.push("-f");
    if (lightweight) {
      args.push(tagName, commitHash);
    } else {
      args.push("-a", tagName, commitHash, "-m", message);
    }
    this.send(repo, args, deliver);
  }

  deleteTag(repo: string, tagName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["tag", "-d", tagName], deliver);
  }

  pushTag(repo: string, tagName: string, remote: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["push", remote, tagName], deliver, NETWORK_TIMEOUT_MS);
  }

  /** Pushes one local branch to a remote, current-checkout or not. */
  pushBranch(repo: string, remote: string, branchName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["push", remote, branchName], deliver, NETWORK_TIMEOUT_MS);
  }

  addRemote(repo: string, name: string, url: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["remote", "add", name, url], deliver);
  }

  renameRemote(repo: string, oldName: string, newName: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["remote", "rename", oldName, newName], deliver);
  }

  removeRemote(repo: string, name: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["remote", "remove", name], deliver);
  }

  setRemoteUrl(repo: string, name: string, url: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["remote", "set-url", name, url], deliver);
  }

  /** Sets `remote.pushDefault` in local config, so a plain push resolves to it. */
  setDefaultRemote(repo: string, name: string, deliver: (status: string | null) => void): void {
    if (repo === "") {
      deliver("No repository is open.");
      return;
    }
    this.send(repo, ["config", "remote.pushDefault", name], deliver);
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
