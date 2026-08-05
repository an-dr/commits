import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueryResponse } from "@an-dr/commits-core/backend/types";
import type { GitResult, GitRun } from "@commits/ipc/native";
import { MitGraphBackend } from "./graph-backend";

type FullDiffResponse = Extract<QueryResponse, { command: "fullDiffContent" }>;

/**
 * Runs the panel queries with real Git, which is the only way to prove the
 * argument shaping resolves revisions and paths as intended.
 *
 * The repository is built here rather than reusing this checkout so every case
 * the panel can be asked for exists and is identical on every machine.
 */
describe("MitGraphBackend read queries integration", () => {
  let repo: string;
  let root: string;
  let second: string;
  let third: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "commits-full-diff-"));
    git(repo, ["init", "--quiet", "--initial-branch=main"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "user.email", "test@example.test"]);
    // The endpoints are compared byte for byte, so the machine's line-ending
    // conversion must not rewrite what Git stores.
    git(repo, ["config", "core.autocrlf", "false"]);

    write(repo, "kept.txt", "one\ntwo\nthree\n");
    write(repo, "moved.txt", "moved one\nmoved two\nmoved three\nmoved four\n");
    writeFileSync(join(repo, "icon.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    root = commit(repo, "first");

    write(repo, "kept.txt", "one\nchanged\nthree\n");
    git(repo, ["mv", "moved.txt", "renamed.txt"]);
    second = commit(repo, "modify and rename");

    unlinkSync(join(repo, "kept.txt"));
    third = commit(repo, "delete");
  });

  // Windows can still hold a Git file briefly after the last command exits.
  afterAll(() => rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));

  it("reads a modified file with the unchanged remainder of both endpoints", () => {
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: second,
      toHash: second,
      oldFilePath: "kept.txt",
      newFilePath: "kept.txt",
      type: "M",
    });

    expect(response.diff).toContain("@@");
    expect(response.oldContent).toBe("one\ntwo\nthree\n");
    expect(response.newContent).toBe("one\nchanged\nthree\n");
    expect(response.oldExists).toBe(true);
    expect(response.newExists).toBe(true);
  });

  it("diffs the first commit against the empty tree", () => {
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: root,
      toHash: root,
      oldFilePath: "kept.txt",
      newFilePath: "kept.txt",
      type: "A",
    });

    expect(response.diff).toContain("@@");
    expect(response.oldExists).toBe(false);
    expect(response.newContent).toBe("one\ntwo\nthree\n");
  });

  it("reads a renamed file as one change under both of its paths", () => {
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: second,
      toHash: second,
      oldFilePath: "moved.txt",
      newFilePath: "renamed.txt",
      type: "R",
    });

    // Rename detection keeps this one file section, which is what lets the
    // panel line the two endpoints up instead of reading a delete and an add.
    expect(response.diff).toContain("rename from moved.txt");
    expect(response.diff!.match(/^diff --git/gm)).toHaveLength(1);
    expect(response.oldContent).toBe(response.newContent);
    expect(response.oldExists).toBe(true);
    expect(response.newExists).toBe(true);
  });

  it("reads a deleted file from its old side only", () => {
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: third,
      toHash: third,
      oldFilePath: "kept.txt",
      newFilePath: "kept.txt",
      type: "D",
    });

    expect(response.diff).toContain("@@");
    expect(response.oldContent).toBe("one\nchanged\nthree\n");
    expect(response.newExists).toBe(false);
    expect(response.newContent).toBeNull();
  });

  it("reports a binary file as having no readable endpoint", () => {
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: root,
      toHash: root,
      oldFilePath: "icon.bin",
      newFilePath: "icon.bin",
      type: "A",
    });

    expect(response.diff).toContain("Binary");
    expect(response.newExists).toBe(false);
    expect(response.newContent).toBeNull();
  });

  it("compares two commits and reads a file across that range", () => {
    const comparison = drive((backend, deliver) =>
      backend.loadComparison(
        { command: "commitComparison", repo, fromHash: root, toHash: third },
        deliver,
      ),
    ) as Extract<QueryResponse, { command: "commitComparison" }>;

    expect(comparison.error).toBeNull();
    expect(comparison.fileChanges).toEqual([
      { oldFilePath: "kept.txt", newFilePath: "kept.txt", type: "D", additions: 0, deletions: 3 },
      { oldFilePath: "moved.txt", newFilePath: "renamed.txt", type: "R", additions: 0, deletions: 0 },
    ]);

    // The file tree of a comparison sends both of its revisions, which is the
    // path that skips parent resolution.
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: root,
      toHash: third,
      oldFilePath: "kept.txt",
      newFilePath: "kept.txt",
      type: "D",
    });
    expect(response.oldContent).toBe("one\ntwo\nthree\n");
    expect(response.newExists).toBe(false);
  });

  it("answers a revision it cannot diff without asking Git", () => {
    const response = loadFullDiff({
      command: "fullDiffContent",
      repo,
      fromHash: "*",
      toHash: "*",
      oldFilePath: "kept.txt",
      newFilePath: "kept.txt",
      type: "M",
    });

    expect(response).toEqual({
      command: "fullDiffContent",
      diff: null,
      oldContent: null,
      newContent: null,
      oldExists: false,
      newExists: false,
    });
  });
});

/** Drives one query to completion, running every request it schedules. */
function drive(
  start: (backend: MitGraphBackend, deliver: (response: QueryResponse) => void) => void,
): QueryResponse {
  const requests: GitRun[] = [];
  const backend = new MitGraphBackend({ runGit: (scheduled) => requests.push(scheduled) });
  const responses: QueryResponse[] = [];
  start(backend, (response) => responses.push(response));

  // Receiving a result can schedule the next stage, so the queue is drained
  // rather than iterated once.
  for (let index = 0; index < requests.length; index++) backend.receive(runGit(requests[index]));

  expect(responses).toHaveLength(1);
  return responses[0];
}

function loadFullDiff(request: Parameters<MitGraphBackend["loadFullDiff"]>[0]): FullDiffResponse {
  return drive((backend, deliver) => backend.loadFullDiff(request, deliver)) as FullDiffResponse;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(repo: string, name: string, content: string): void {
  writeFileSync(join(repo, name), content);
}

/** Commits everything in the work tree and returns the new commit's hash. */
function commit(repo: string, message: string): string {
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "--quiet", "--message", message]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

/** Stands in for the native Git service, which the component cannot call here. */
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
