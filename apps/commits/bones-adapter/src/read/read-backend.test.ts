import { describe, expect, it } from "vitest";
import { ReadBackend, type RepositorySnapshot } from "./read-backend";
import type { GitResult, GitRun } from "@commits/ipc/native";

describe("ReadBackend", () => {
  it("issues bounded correlated reads and delivers a parsed repository snapshot", () => {
    const requests: GitRun[] = [];
    const snapshots: RepositorySnapshot[] = [];
    const backend = new ReadBackend({ runGit: (request) => requests.push(request), deliver: (snapshot) => snapshots.push(snapshot) });
    backend.load("C:/repo", 25, false);
    expect(requests).toHaveLength(3);
    expect(requests[0].args).toContain("--max-count=25");
    expect(requests[1].args).not.toContain("refs/remotes");

    respond(backend, requests[0], "%H%x1f");
    respond(backend, requests[1], "aaaaaaa\u001frefs/heads/main\u001f\n");
    respond(backend, requests[2], "main\n");

    expect(snapshots).toEqual([{ repository: "C:/repo", commits: [], errors: [], refs: {
      head: "main", branches: [{ name: "main", hash: "aaaaaaa" }], tags: [], remotes: [],
    } }]);
  });

  it("returns bounded errors while allowing detached HEAD", () => {
    const requests: GitRun[] = [];
    const snapshots: RepositorySnapshot[] = [];
    const backend = new ReadBackend({ runGit: (request) => requests.push(request), deliver: (snapshot) => snapshots.push(snapshot) });
    backend.load("C:/repo", 10, true);
    respond(backend, requests[0], "abc1234\u001f\u001fAda\u001fada@example.test\u001f12\u001fsubject\n");
    respond(backend, requests[1], "");
    backend.receive({ requestId: requests[2].requestId, status: "completed", exitCode: 1, stdout: new Uint8Array(), stderr: new TextEncoder().encode("detached") });

    expect(snapshots[0].refs.head).toBeNull();
    expect(snapshots[0].commits[0]?.author).toBe("Ada");
    expect(snapshots[0].errors).toEqual([]);
  });

  it("drops late results after a newer refresh for the same repository", () => {
    const requests: GitRun[] = [];
    const snapshots: RepositorySnapshot[] = [];
    const backend = new ReadBackend({ runGit: (request) => requests.push(request), deliver: (snapshot) => snapshots.push(snapshot) });
    backend.load("C:/repo", 10, true);
    const first = requests.splice(0);
    backend.load("C:/repo", 10, true);
    first.forEach((request) => respond(backend, request, ""));
    expect(snapshots).toEqual([]);
  });
});

function respond(backend: ReadBackend, request: GitRun, stdout: string): void {
  const result: GitResult = { requestId: request.requestId, status: "completed", exitCode: 0, stdout: new TextEncoder().encode(stdout), stderr: new Uint8Array() };
  backend.receive(result);
}
