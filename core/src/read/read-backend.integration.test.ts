import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { GitResult, GitRun } from "../../../ipc/ts/native";
import { ReadBackend, type RepositorySnapshot } from "./read-backend";

describe("ReadBackend integration", () => {
  it("returns current-repository JSON while Git work stays outside request dispatch", () => {
    const requests: GitRun[] = [];
    const snapshots: RepositorySnapshot[] = [];
    const backend = new ReadBackend({
      runGit: (request) => requests.push(request),
      deliver: (snapshot) => snapshots.push(snapshot),
    });

    backend.load(process.cwd(), 20, true);
    // Scheduling three native requests is immediate; no Git command has run in
    // the component request handler at this point.
    expect(requests).toHaveLength(3);

    for (const request of requests) backend.receive(runGit(request));

    const [snapshot] = snapshots;
    expect(snapshot.commits.length).toBeGreaterThan(0);
    const json = JSON.parse(JSON.stringify(snapshot)) as RepositorySnapshot;
    expect(json.repository).toEqual(expect.any(String));
    expect(json.commits[0]).toMatchObject({ hash: expect.any(String), subject: expect.any(String) });
    expect(json.refs).toEqual(expect.any(Object));
  });
});

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
