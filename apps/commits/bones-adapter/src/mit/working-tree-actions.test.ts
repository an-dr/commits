import { describe, expect, it } from "vitest";
import type { GitResult, GitRun } from "@commits/ipc/native";
import { WorkingTreeActions, type WorkingTreeAction } from "./working-tree-actions";

describe("WorkingTreeActions", () => {
  it("stages files with an explicit list behind a path separator", () => {
    const { requests } = run({ command: "stageFiles", files: ["src/a.ts", "src/b.ts"] });

    expect(requests[0].args).toEqual(["add", "--", "src/a.ts", "src/b.ts"]);
    expect(requests[0].cwd).toBe("C:/repo");
    expect(requests[0].timeoutMs).toBe(30_000);
  });

  it("unstages without touching the working tree", () => {
    const { requests } = run({ command: "unstageFiles", files: ["src/a.ts"] });

    expect(requests[0].args).toEqual(["reset", "--quiet", "HEAD", "--", "src/a.ts"]);
  });

  it("discards a tracked file back to the index", () => {
    const { requests } = run({ command: "discardFiles", files: ["src/a.ts"], untracked: false });

    expect(requests[0].args).toEqual(["checkout", "--quiet", "--", "src/a.ts"]);
  });

  it("removes an untracked file, which has no earlier version to restore", () => {
    const { requests } = run({ command: "discardFiles", files: ["fresh.ts"], untracked: true });

    expect(requests[0].args).toEqual(["clean", "--quiet", "--force", "--", "fresh.ts"]);
  });

  it("reports success as no status and a failure in Git's own words", () => {
    const succeeded = run({ command: "stageFiles", files: ["a.ts"] });
    succeeded.complete(0, "");
    expect(succeeded.statuses).toEqual([null]);

    const failed = run({ command: "stageFiles", files: ["a.ts"] });
    failed.complete(128, "fatal: pathspec 'a.ts' did not match any files");
    expect(failed.statuses).toEqual(["fatal: pathspec 'a.ts' did not match any files"]);
  });

  it("refuses an empty request rather than running Git with no files", () => {
    const empty = run({ command: "stageFiles", files: [] });
    expect(empty.requests).toHaveLength(0);
    expect(empty.statuses).toEqual(["Nothing to do."]);

    const noRepo = run({ command: "stageFiles", files: ["a.ts"] }, "");
    expect(noRepo.requests).toHaveLength(0);
    expect(noRepo.statuses).toEqual(["Nothing to do."]);
  });
});

function run(action: WorkingTreeAction, repo = "C:/repo") {
  const requests: GitRun[] = [];
  const statuses: (string | null)[] = [];
  const actions = new WorkingTreeActions({ runGit: (request) => requests.push(request) });
  actions.run(repo, action, (status) => statuses.push(status));
  const complete = (exitCode: number, stderr: string) => {
    const result: GitResult = {
      requestId: requests[0].requestId,
      status: "completed",
      exitCode,
      stdout: new Uint8Array(),
      stderr: new TextEncoder().encode(stderr),
    };
    actions.receive(result);
  };
  return { requests, statuses, complete };
}
