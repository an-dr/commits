import { describe, expect, it } from "vitest";
import { parseStatus, HealthReader } from "./facts";
import type { HostPort } from "../host/host-port";
import type { GitRun } from "@commits/ipc/native";
describe("health facts", () => {
  it("counts paths once and parses upstream divergence and conflicts", () => {
    expect(parseStatus("# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 MM change\n2 R. rename\nu UU conflict\n? untracked\n")).toEqual({ branch: "main", detached: false, hasUpstream: true, ahead: 2, behind: 3, changes: 4, conflicted: 1,
      workingTree: { staged: 2, changed: 1, conflicts: 1, untracked: 1 } });
  });
  it("handles detached and unpublished status", () => {
    expect(parseStatus("# branch.head (detached)\n")).toMatchObject({ detached: true, hasUpstream: false, branch: null });
    expect(parseStatus("# branch.head topic\n")).toMatchObject({ detached: false, hasUpstream: false, branch: "topic" });
  });
  it("combines bisect metadata with git facts and rejects stale generations", () => {
    const requests: GitRun[] = [];
    const delivered: unknown[] = [];
    const reader = new HealthReader({ runGit: (request) => requests.push(request), repositoryState: () => ({ exists: true, isRepo: true, operation: "bisect" }) }, (health) => delivered.push(health));
    reader.refresh("old"); reader.refresh("new");
    for (const request of requests) reader.receive({ requestId: request.requestId, status: "completed", exitCode: 0,
      stdout: new TextEncoder().encode(request.args[0] === "status" ? "# branch.head main\n" : "value"), stderr: new Uint8Array() });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ repository: "new", facts: { operation: "bisect", hasRemote: true }, verdict: { id: "in-progress" } });
  });
});
