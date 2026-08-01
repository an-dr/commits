import { describe, expect, it } from "vitest";
import type { GitResult, GitRun, NativeResult, OsAction } from "@commits/ipc/native";
import { CommitsCore } from "./commits-core";
import type { HostPort, LogLevel } from "./host/host-port";

class StubHost implements HostPort {
  readonly closed: string[] = [];
  readonly logs: Array<[LogLevel, string]> = [];
  readonly opened: Array<[string, string]> = [];
  readonly sent: Array<[string, unknown]> = [];
  readonly topics: string[] = [];
  readonly osRequests: unknown[] = [];
  readonly gitRequests: GitRun[] = [];
  readonly promptReplies: string[] = [];
  savedState: Uint8Array<ArrayBufferLike> = new Uint8Array();
  paths: string[] = [];

  closePanel(panel: string): void { this.closed.push(panel); }
  log(level: LogLevel, message: string): void { this.logs.push([level, message]); }
  openPanel(panel: string, html: string): void { this.opened.push([panel, html]); }
  repositoryPaths(): readonly string[] { return this.paths; }
  loadSavedState(): Uint8Array<ArrayBufferLike> { return this.savedState; }
  saveSavedState(value: Uint8Array<ArrayBufferLike>): void { this.savedState = value; }
  runGit(request: GitRun): void { this.gitRequests.push(request); }
  respondPrompt(id: string, value: string): void { this.promptReplies.push(`${id}:${value}`); }
  requestOs(requestId: number, action: OsAction, value?: string): void {
    this.osRequests.push({ requestId, action, value });
  }
  sendPageMessage(panel: string, message: unknown): void { this.sent.push([panel, message]); }
  subscribe(topic: string): void { this.topics.push(topic); }
}

describe("CommitsCore MIT webview host", () => {
  it("opens the shared graph page and subscribes to native results", () => {
    const host = new StubHost();
    const core = new CommitsCore(host, "<main>MIT graph</main>");

    core.start();

    expect(host.opened).toEqual([["main", "<main>MIT graph</main>"]]);
    expect(host.topics).toEqual(["web/*", "os/result", "os/prompt", "git/completed"]);
  });

  it("boots the shared repository selector from host repositories", () => {
    const host = new StubHost();
    host.paths = ["C:\\repo"];
    const core = new CommitsCore(host, "");

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "loadRepos",
      repos: { "C:/repo": { columnWidths: null } },
      lastActiveRepo: "C:/repo",
    }]);
  });

  it("asks Bones for a folder when no repository is available", () => {
    const host = new StubHost();
    const core = new CommitsCore(host, "");

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    expect(host.sent).toContainEqual(["main", { command: "standaloneRepositoryRequired" }]);

    core.receivePageJson(JSON.stringify({ command: "standaloneChooseRepository" }));
    expect(host.osRequests).toEqual([{ requestId: 50_000, action: "pick-folder", value: undefined }]);
  });

  it("maps the MIT commit query to bounded correlated native Git reads", () => {
    const host = new StubHost();
    host.paths = ["C:/repo"];
    const core = new CommitsCore(host, "");
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({
      command: "loadCommits",
      repo: "C:/repo",
      branchName: "",
      maxCommits: 100,
      showRemoteBranches: true,
      hard: false,
    }));

    expect(host.gitRequests).toHaveLength(3);
    expect(host.gitRequests.every((request) => request.cwd === "C:/repo" && request.timeoutMs === 15_000)).toBe(true);
    completeGit(host, core, "log", "abc1234\u001f\u001fAda\u001fada@example.test\u001f1\u001fInitial\n");
    completeGit(host, core, "show-ref", "abc1234 refs/heads/main\nabc1234 HEAD\n");
    completeGit(host, core, "status", "");

    expect(host.sent).toContainEqual(["main", expect.objectContaining({
      command: "loadCommits",
      head: "abc1234",
      commits: [expect.objectContaining({ hash: "abc1234", message: "Initial" })],
    })]);
  });

  it("ignores malformed page JSON", () => {
    const host = new StubHost();
    const core = new CommitsCore(host, "");
    core.receivePageJson("{not json");
    expect(host.logs).toContainEqual(["warn", "ignored malformed page JSON"]);
  });
});

function completeGit(host: StubHost, core: CommitsCore, command: string, stdout: string): void {
  const request = host.gitRequests.find((candidate) => candidate.args[0] === command);
  if (request === undefined) throw new Error(`missing ${command} request`);
  const result: GitResult = {
    requestId: request.requestId,
    status: "completed",
    exitCode: 0,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
  };
  core.receiveGitResult(result);
}
