import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GitResult, GitRun } from "@commits/ipc/native";
import {
  WorkingTreeActions,
  type CommitAction,
  type WorkingTreeAction,
} from "./working-tree-actions";

/**
 * Mutations run for real here, in a repository built and thrown away by the
 * test, which is the only place this repository allows them to run.
 */
describe("WorkingTreeActions integration", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "commits-actions-"));
    git(["init", "--quiet", "--initial-branch=main"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.test"]);
    git(["config", "core.autocrlf", "false"]);
    write("tracked.txt", "one\n");
    git(["add", "--all"]);
    git(["commit", "--quiet", "--message", "first"]);
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));

  it("stages a change and takes it back out again", () => {
    write("tracked.txt", "one\ntwo\n");

    expect(perform({ command: "stageFiles", files: ["tracked.txt"] })).toBeNull();
    expect(git(["diff", "--cached", "--name-only"]).trim()).toBe("tracked.txt");

    expect(perform({ command: "unstageFiles", files: ["tracked.txt"] })).toBeNull();
    expect(git(["diff", "--cached", "--name-only"]).trim()).toBe("");
    // Unstaging leaves the file on disk as the user left it.
    expect(git(["diff", "--name-only"]).trim()).toBe("tracked.txt");
  });

  it("discards a tracked file back to the index, keeping what was staged", () => {
    write("tracked.txt", "one\nstaged\n");
    git(["add", "tracked.txt"]);
    write("tracked.txt", "one\nstaged\nunstaged\n");

    expect(perform({ command: "discardFiles", files: ["tracked.txt"], untracked: false })).toBeNull();

    expect(git(["show", ":tracked.txt"])).toBe("one\nstaged\n");
    expect(git(["diff", "--name-only"]).trim()).toBe("");
    git(["reset", "--quiet", "--hard", "HEAD"]);
  });

  it("removes an untracked file it is asked to discard", () => {
    write("fresh.txt", "temporary\n");

    expect(perform({ command: "discardFiles", files: ["fresh.txt"], untracked: true })).toBeNull();

    expect(existsSync(join(repo, "fresh.txt"))).toBe(false);
  });

  it("commits what is staged and then amends it", () => {
    write("committed.txt", "first\n");
    git(["add", "committed.txt"]);

    expect(commit({ message: "add committed", amend: false })).toBeNull();
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("add committed");

    expect(commit({ message: "add committed, renamed", amend: true })).toBeNull();
    expect(git(["log", "-1", "--format=%s"]).trim()).toBe("add committed, renamed");
    // Amending rewrote the commit rather than adding one beside it.
    expect(git(["rev-list", "--count", "HEAD"]).trim()).toBe("2");
  });

  it("refuses a commit with no message before Git can open an editor", () => {
    expect(commit({ message: "   ", amend: false })).toBe("A commit needs a message.");
  });

  it("reports Git's refusal to commit an empty index", () => {
    const status = commit({ message: "nothing staged", amend: false });

    expect(status).not.toBeNull();
  });

  it("reports Git's refusal for a path it does not know", () => {
    const status = perform({ command: "stageFiles", files: ["missing.txt"] });

    expect(status).toContain("did not match any files");
  });

  /** Runs one action to completion and returns the status the view would get. */
  function perform(action: WorkingTreeAction): string | null {
    return drive((actions, deliver) => actions.run(repo, action, deliver));
  }

  function commit(action: CommitAction): string | null {
    return drive((actions, deliver) => actions.commit(repo, action, deliver));
  }

  function drive(
    start: (actions: WorkingTreeActions, deliver: (status: string | null) => void) => void
  ): string | null {
    const requests: GitRun[] = [];
    const actions = new WorkingTreeActions({ runGit: (request) => requests.push(request) });
    const statuses: (string | null)[] = [];
    start(actions, (status) => statuses.push(status));
    for (const request of requests) actions.receive(runGit(request));
    expect(statuses).toHaveLength(1);
    return statuses[0];
  }

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  function write(name: string, content: string): void {
    writeFileSync(join(repo, name), content);
  }
});

/** Stands in for the native Git service the component cannot call here. */
function runGit(request: GitRun): GitResult {
  try {
    return {
      requestId: request.requestId,
      status: "completed",
      exitCode: 0,
      stdout: new Uint8Array(execFileSync("git", request.args, { cwd: request.cwd })),
      stderr: new Uint8Array(),
    };
  } catch (error) {
    const result = error as { status?: number; stdout?: Uint8Array; stderr?: Uint8Array };
    return {
      requestId: request.requestId,
      status: "completed",
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? new Uint8Array(),
      stderr: result.stderr ?? new Uint8Array(),
    };
  }
}
