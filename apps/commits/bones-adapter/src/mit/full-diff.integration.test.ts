import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { GitFileChangeType, QueryResponse } from "@an-dr/commits-core/backend/types";
import type { GitResult, GitRun } from "@commits/ipc/native";
import { MitGraphBackend } from "./graph-backend";

type FullDiffResponse = Extract<QueryResponse, { command: "fullDiffContent" }>;

/**
 * Runs the panel query against this repository with real Git, which is the only
 * way to prove the argument shaping resolves revisions and paths as intended.
 */
describe("MitGraphBackend full diff integration", () => {
  it("reads a changed file of the newest commit with both endpoints", () => {
    const hash = git(["rev-parse", "HEAD"]).trim();
    const change = firstChange(hash, false);

    const response = loadFullDiff({
      command: "fullDiffContent",
      repo: process.cwd(),
      fromHash: hash,
      toHash: hash,
      ...change,
    });

    expect(response.diff).toContain("@@");
    expect(response.newExists).toBe(change.type !== "D");
    expect(response.oldExists).toBe(change.type !== "A");
    if (response.newExists) expect(response.newContent).toEqual(expect.any(String));
  });

  it("reads the first commit, which has no parent to diff against", () => {
    const root = nonEmptyLines(git(["rev-list", "--max-parents=0", "HEAD"])).pop()!;
    const change = firstChange(root, true);

    const response = loadFullDiff({
      command: "fullDiffContent",
      repo: process.cwd(),
      fromHash: root,
      toHash: root,
      ...change,
    });

    expect(response.diff).toContain("@@");
    expect(response.oldExists).toBe(false);
    expect(response.newExists).toBe(true);
  });
});

/** First changed file of a commit, as the view's file tree reports one. */
function firstChange(
  hash: string,
  root: boolean,
): { oldFilePath: string; newFilePath: string; type: GitFileChangeType } {
  const args = ["diff-tree", "--no-commit-id", "--name-status", "-r", "-M"];
  if (root) args.push("--root");
  const parts = nonEmptyLines(git([...args, hash]))[0].split("\t");
  const type = parts[0].charAt(0) as GitFileChangeType;
  return {
    oldFilePath: parts[1],
    newFilePath: type === "R" ? parts[2] : parts[1],
    type,
  };
}

/** Drives the query to completion, running every request it schedules. */
function loadFullDiff(request: Parameters<MitGraphBackend["loadFullDiff"]>[0]): FullDiffResponse {
  const requests: GitRun[] = [];
  const backend = new MitGraphBackend({ runGit: (scheduled) => requests.push(scheduled) });
  const responses: FullDiffResponse[] = [];
  backend.loadFullDiff(request, (response) => responses.push(response as FullDiffResponse));

  // Receiving a result can schedule the next stage, so the queue is drained
  // rather than iterated once.
  for (let index = 0; index < requests.length; index++) backend.receive(runGit(requests[index]));

  expect(responses).toHaveLength(1);
  return responses[0];
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
}

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

function nonEmptyLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
}
