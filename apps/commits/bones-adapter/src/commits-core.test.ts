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
  pageHtml = "<main>MIT graph</main>";

  closePanel(panel: string): void { this.closed.push(panel); }
  log(level: LogLevel, message: string): void { this.logs.push([level, message]); }
  openPanel(panel: string, html: string): void { this.opened.push([panel, html]); }
  repositoryPaths(): readonly string[] { return this.paths; }
  loadPageHtml(): string { return this.pageHtml; }
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
    const core = new CommitsCore(host);

    core.start();

    expect(host.opened).toEqual([["main", "<main>MIT graph</main>"]]);
    expect(host.topics).toEqual(["web/*", "os/result", "os/prompt", "git/completed"]);
  });

  it("boots the shared repository selector from host repositories", () => {
    const host = new StubHost();
    host.paths = ["C:\\repo"];
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "loadRepos",
      repos: { "C:/repo": { columnWidths: null } },
      lastActiveRepo: "C:/repo",
    }]);
  });

  it("asks Bones for a folder when no repository is available", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    expect(host.sent).toContainEqual(["main", { command: "standaloneRepositoryRequired", recent: [] }]);

    core.receivePageJson(JSON.stringify({ command: "standaloneChooseRepository" }));
    expect(host.osRequests).toEqual([{ requestId: 50_000, action: "pick-folder", value: undefined }]);
  });

  it("maps the MIT commit query to bounded correlated native Git reads", () => {
    const host = new StubHost();
    host.paths = ["C:/repo"];
    const core = new CommitsCore(host);
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

  it("serves a repository query that arrives before standaloneReady", () => {
    // The shared view starts querying as soon as it mounts, which happens
    // before the standalone page reports readiness. A dropped query is never
    // retried, so the view would wait for a reply that never comes.
    const host = new StubHost();
    host.savedState = new TextEncoder().encode(
      JSON.stringify({
        settings: {},
        state: { version: 1, lastActiveRepository: "C:/repo", selectedCommit: null, find: "", findIsCaseSensitive: false, findIsRegex: false },
      }),
    );
    const core = new CommitsCore(host);
    core.start();

    core.receivePageJson(JSON.stringify({ command: "loadBranches", showRemoteBranches: true, hard: false }));

    expect(host.gitRequests.length).toBeGreaterThan(0);
  });

  it("loads commits in the order the shared view actually emits", () => {
    const host = new StubHost();
    host.savedState = new TextEncoder().encode(
      JSON.stringify({
        settings: {},
        state: { version: 1, lastActiveRepository: "C:/repo", selectedCommit: null, find: "", findIsCaseSensitive: false, findIsRegex: false },
      }),
    );
    const core = new CommitsCore(host);
    core.start();

    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));
    core.receivePageJson(JSON.stringify({ command: "loadCommits", repo: "C:/repo", branchName: "", maxCommits: 300, showRemoteBranches: true, hard: false }));
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.gitRequests.some((request) => request.args[0] === "log")).toBe(true);
  });

  it("records opened repositories as recent, most recent first", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/one" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/two" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/one" }));

    const saved = JSON.parse(new TextDecoder().decode(host.savedState));
    expect(saved.state.recentRepositories).toEqual(["C:/one", "C:/two"]);
  });

  it("offers recent repositories when none can be opened", () => {
    const host = new StubHost();
    host.savedState = new TextEncoder().encode(JSON.stringify({
      settings: {},
      state: {
        version: 1,
        lastActiveRepository: null,
        recentRepositories: ["C:/one", "C:/two"],
        selectedCommit: null,
        find: "",
        findIsCaseSensitive: false,
        findIsRegex: false,
      },
    }));
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneRepositoryRequired",
      recent: ["C:/one", "C:/two"],
    }]);
  });

  it("answers commitDetails with metadata and changed files", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({ command: "commitDetails", repo: "C:/repo", commitHash: "abc1234" }));

    completeGit(host, core, "show",
      ["abc1234", "par1 par2", "Ada", "ada@example.com", "1700000000", "Grace", "Subject line", "", "Body text"]
        .join("\u001f").replace("\u001fBody text", "\nBody text"));
    completeGitAt(host, core, 1, "M\tsrc/a.ts\nR100\told.ts\tnew.ts\nA\tadded.ts");
    completeGitAt(host, core, 2, "3\t1\tsrc/a.ts\n5\t0\tnew.ts\n2\t0\tadded.ts");

    const reply = host.sent.map(([, message]) => message as { command: string; commitDetails?: unknown })
      .find((message) => message.command === "commitDetails");
    expect(reply?.commitDetails).toMatchObject({
      hash: "abc1234",
      parents: ["par1", "par2"],
      author: "Ada",
      email: "ada@example.com",
      date: 1_700_000_000,
      committer: "Grace",
      fileChanges: [
        { oldFilePath: "src/a.ts", newFilePath: "src/a.ts", type: "M", additions: 3, deletions: 1 },
        { oldFilePath: "old.ts", newFilePath: "new.ts", type: "R", additions: 5, deletions: 0 },
        { oldFilePath: "added.ts", newFilePath: "added.ts", type: "A", additions: 2, deletions: 0 },
      ],
    });
  });

  it("reports commitDetails as null when the commit cannot be read", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({ command: "commitDetails", repo: "C:/repo", commitHash: "nothex!" }));

    const reply = host.sent.map(([, message]) => message as { command: string; commitDetails?: unknown })
      .find((message) => message.command === "commitDetails");
    expect(reply?.commitDetails).toBeNull();
  });

  it("logs across every selected branch", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "loadCommits",
      repo: "C:/repo",
      branchName: "main",
      branches: ["main", "dev"],
      maxCommits: 300,
      showRemoteBranches: true,
      hard: false,
    }));

    const log = host.gitRequests.find((request) => request.args[0] === "log");
    expect(log?.args).toEqual(expect.arrayContaining(["main", "dev"]));
    expect(log?.args).not.toContain("--branches");
  });

  it("logs across every ref when nothing is selected", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "loadCommits",
      repo: "C:/repo",
      branchName: "",
      branches: [""],
      maxCommits: 300,
      showRemoteBranches: true,
      hard: false,
    }));

    const log = host.gitRequests.find((request) => request.args[0] === "log");
    expect(log?.args).toContain("--branches");
  });

  it("points the view at a newly opened repository", () => {
    const host = new StubHost();
    host.paths = ["C:/first"];
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneOpenRepository", path: "C:/second" }));

    const loadRepos = host.sent
      .map(([, message]) => message as { command: string; lastActiveRepo?: string | null })
      .filter((message) => message.command === "loadRepos")
      .pop();
    expect(loadRepos?.lastActiveRepo).toBe("C:/second");
  });

  it("ignores malformed page JSON", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
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

function completeGitAt(host: StubHost, core: CommitsCore, index: number, stdout: string): void {
  const request = host.gitRequests[index];
  if (request === undefined) throw new Error(`missing git request ${index}`);
  core.receiveGitResult({
    requestId: request.requestId,
    status: "completed",
    exitCode: 0,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
  });
}
