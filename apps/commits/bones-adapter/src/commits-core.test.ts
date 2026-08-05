import { describe, expect, it } from "vitest";
import type { GitResult, GitRun, NativeResult, OsAction } from "@commits/ipc/native";
import { CommitsCore } from "./commits-core";
import type { HostPort, LogLevel, PageSource } from "./host/host-port";

class StubHost implements HostPort {
  readonly closed: string[] = [];
  readonly logs: Array<[LogLevel, string]> = [];
  readonly opened: Array<[string, PageSource]> = [];
  readonly sent: Array<[string, unknown]> = [];
  readonly topics: string[] = [];
  readonly osRequests: unknown[] = [];
  readonly gitRequests: GitRun[] = [];
  readonly promptReplies: string[] = [];
  savedState: Uint8Array<ArrayBufferLike> = new Uint8Array();
  paths: string[] = [];
  pageSource: PageSource = { kind: "url", value: "file:///commits/page.html" };

  closePanel(panel: string): void { this.closed.push(panel); }
  log(level: LogLevel, message: string): void { this.logs.push([level, message]); }
  openPanel(panel: string, source: PageSource): void { this.opened.push([panel, source]); }
  repositoryPaths(): readonly string[] { return this.paths; }
  loadPageSource(): PageSource { return this.pageSource; }
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

    expect(host.opened).toEqual([["main", { kind: "url", value: "file:///commits/page.html" }]]);
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
    // Git prints a rename's counts against the arrow form, which has to reduce
    // to the new path or the rename would show no counts at all.
    completeGitAt(host, core, 2, "3\t1\tsrc/a.ts\n5\t0\t{old.ts => new.ts}\n2\t0\tadded.ts");

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

  it("reports the working tree as staged and unstaged entries", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({ command: "workingTreeChanges", repo: "C:/repo" }));

    expect(host.gitRequests[0].args).toEqual([
      "status", "--porcelain=v2", "-z", "--untracked-files=all",
    ]);
    expect(host.gitRequests[1].args).toContain("--cached");
    // A file modified in both places, one staged only, one untracked, and a
    // rename, which names its old path in a field of its own.
    completeGitAt(host, core, 0, [
      "1 MM N... 100644 100644 100644 aaa bbb both.ts",
      "1 M. N... 100644 100644 100644 aaa bbb staged.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts",
      "old.ts",
      "? fresh.ts",
      "",
    ].join("\0"));
    completeGitAt(host, core, 1, "3\t1\tboth.ts\x002\t0\tstaged.ts\x005\t0\t\x00old.ts\x00new.ts\x00");
    completeGitAt(host, core, 2, "1\t1\tboth.ts\x007\t0\tfresh.ts\x00");

    const reply = host.sent
      .map(([, message]) => message as { command: string; changes?: unknown[]; error?: string | null })
      .find((message) => message.command === "workingTreeChanges");
    expect(reply?.error).toBeNull();
    expect(reply?.changes).toEqual([
      { path: "both.ts", oldPath: undefined, status: "M", staged: true, additions: 3, deletions: 1, submodule: null },
      { path: "both.ts", status: "M", staged: false, additions: 1, deletions: 1, submodule: null },
      { path: "staged.ts", oldPath: undefined, status: "M", staged: true, additions: 2, deletions: 0, submodule: null },
      { path: "new.ts", oldPath: "old.ts", status: "R", staged: true, additions: 5, deletions: 0, submodule: null },
      { path: "fresh.ts", status: "U", staged: false, additions: 7, deletions: 0, submodule: null },
    ]);
  });

  it("reports why the working tree could not be read", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({ command: "workingTreeChanges", repo: "C:/repo" }));
    failGitAt(host, core, 0, "fatal: not a git repository");
    completeGitAt(host, core, 1, "");
    completeGitAt(host, core, 2, "");

    const reply = host.sent
      .map(([, message]) => message as { command: string; error?: string | null })
      .find((message) => message.command === "workingTreeChanges");
    expect(reply?.error).toBe("fatal: not a git repository");
  });

  it("reports what each branch tracks and where each remote points", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "loadBranches", showRemoteBranches: true, hard: false,
    }));

    completeGitAt(host, core, 0, "refs/heads/main\nrefs/remotes/origin/main\n");
    completeGitAt(host, core, 1, "main\n");
    completeGitAt(host, core, 2, "main\u001forigin/main\nwork\u001f\n");
    completeGitAt(host, core, 3,
      "origin\thttps://github.com/an-dr/commits (fetch)\norigin\tssh://git@github.com/an-dr/commits (push)\n");

    expect(host.sent).toContainEqual(["main", expect.objectContaining({
      command: "loadBranches",
      upstreams: { main: "origin/main" },
      remotes: { origin: "https://github.com/an-dr/commits" },
    })]);
  });

  it("answers commitComparison with the files that differ", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "commitComparison", repo: "C:/repo", fromHash: "aaa1111", toHash: "bbb2222",
    }));

    expect(host.gitRequests[0].args).toEqual([
      "diff", "--no-color", "--no-ext-diff", "-M", "-r", "--name-status", "aaa1111", "bbb2222",
    ]);
    expect(host.gitRequests[1].args).toContain("--numstat");
    completeGitAt(host, core, 0, "M\tsrc/a.ts\nR100\told.ts\tnew.ts\n");
    completeGitAt(host, core, 1, "3\t1\tsrc/a.ts\n5\t0\told.ts => new.ts\n");

    expect(host.sent).toContainEqual(["main", {
      command: "commitComparison",
      error: null,
      fileChanges: [
        { oldFilePath: "src/a.ts", newFilePath: "src/a.ts", type: "M", additions: 3, deletions: 1 },
        { oldFilePath: "old.ts", newFilePath: "new.ts", type: "R", additions: 5, deletions: 0 },
      ],
    }]);
  });

  it("reports a comparison the host cannot make instead of staying silent", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "commitComparison", repo: "C:/repo", fromHash: "*", toHash: "bbb2222",
    }));

    expect(host.gitRequests).toHaveLength(0);
    const reply = host.sent
      .map(([, message]) => message as { command: string; error?: string | null })
      .find((message) => message.command === "commitComparison");
    expect(reply?.error).toContain("cannot be compared");
  });

  it("carries Git's own reason when a comparison fails", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "commitComparison", repo: "C:/repo", fromHash: "aaa1111", toHash: "bbb2222",
    }));
    failGitAt(host, core, 0, "fatal: bad object bbb2222");
    completeGitAt(host, core, 1, "");

    const reply = host.sent
      .map(([, message]) => message as { command: string; error?: string | null })
      .find((message) => message.command === "commitComparison");
    expect(reply?.error).toBe("fatal: bad object bbb2222");
  });

  it("answers only the newest comparison", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "commitComparison", repo: "C:/repo", fromHash: "aaa1111", toHash: "bbb2222",
    }));
    core.receivePageJson(JSON.stringify({
      command: "commitComparison", repo: "C:/repo", fromHash: "ccc3333", toHash: "ddd4444",
    }));
    for (const index of [2, 3]) completeGitAt(host, core, index, "M\tsecond.ts\n");
    for (const index of [0, 1]) completeGitAt(host, core, index, "M\tfirst.ts\n");

    const replies = host.sent
      .map(([, message]) => message as { command: string; fileChanges?: Array<{ newFilePath: string }> })
      .filter((message) => message.command === "commitComparison");
    expect(replies).toHaveLength(1);
    expect(replies[0].fileChanges?.[0].newFilePath).toBe("second.ts");
  });

  it("answers fullDiffContent with the file diff and both endpoints", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest()));

    expect(host.gitRequests[0].args).toEqual(["rev-list", "--parents", "-n", "1", "abc1234"]);
    completeGitAt(host, core, 0, "abc1234 par1 par2\n");

    expect(host.gitRequests[1].args).toEqual([
      "diff", "--no-color", "--no-ext-diff", "-M", "par1", "abc1234", "--", "src/a.ts",
    ]);
    expect(host.gitRequests[2].args).toEqual(["show", "par1:src/a.ts"]);
    expect(host.gitRequests[3].args).toEqual(["show", "abc1234:src/a.ts"]);
    completeGitAt(host, core, 1, "@@ -1 +1 @@\n-old\n+new\n");
    completeGitAt(host, core, 2, "old\n");
    completeGitAt(host, core, 3, "new\n");

    expect(fullDiffReply(host)).toEqual({
      command: "fullDiffContent",
      diff: "@@ -1 +1 @@\n-old\n+new\n",
      oldContent: "old\n",
      newContent: "new\n",
      oldExists: true,
      newExists: true,
    });
  });

  it("diffs a root commit against the empty tree", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest()));
    completeGitAt(host, core, 0, "abc1234\n");

    expect(host.gitRequests[1].args).toContain("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    completeGitAt(host, core, 1, "@@ -0,0 +1 @@\n+new\n");
    completeGitAt(host, core, 2, "", 128);
    completeGitAt(host, core, 3, "new\n");

    expect(fullDiffReply(host)).toMatchObject({ oldExists: false, oldContent: null, newExists: true });
  });

  it("reads only the surviving endpoint of an added file", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({ type: "A" })));
    completeGitAt(host, core, 0, "abc1234 par1\n");

    expect(host.gitRequests).toHaveLength(3);
    expect(host.gitRequests[2].args).toEqual(["show", "abc1234:src/a.ts"]);
    completeGitAt(host, core, 1, "@@ -0,0 +1 @@\n+new\n");
    completeGitAt(host, core, 2, "new\n");

    expect(fullDiffReply(host)).toMatchObject({ oldExists: false, newExists: true });
  });

  it("reads only the surviving endpoint of a deleted file", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({ type: "D" })));
    completeGitAt(host, core, 0, "abc1234 par1\n");

    expect(host.gitRequests).toHaveLength(3);
    expect(host.gitRequests[2].args).toEqual(["show", "par1:src/a.ts"]);
    completeGitAt(host, core, 1, "@@ -1 +0,0 @@\n-old\n");
    completeGitAt(host, core, 2, "old\n");

    expect(fullDiffReply(host)).toMatchObject({ oldExists: true, newExists: false, newContent: null });
  });

  it("treats a binary endpoint as absent instead of decoding it", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({ newFilePath: "icon.png", oldFilePath: "icon.png" })));
    completeGitAt(host, core, 0, "abc1234 par1\n");
    completeGitAt(host, core, 1, "Binary files a/icon.png and b/icon.png differ\n");
    completeGitAt(host, core, 2, "\u0000\u0001PNG");
    completeGitAt(host, core, 3, "\u0000\u0002PNG");

    expect(fullDiffReply(host)).toMatchObject({
      oldExists: false,
      oldContent: null,
      newExists: false,
      newContent: null,
    });
  });

  it("answers only the newest file read", () => {
    // The reply names no file, so a slower earlier read would otherwise land
    // under the filename of the file clicked after it.
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({ newFilePath: "first.ts", oldFilePath: "first.ts" })));
    core.receivePageJson(JSON.stringify(fullDiffRequest({ newFilePath: "second.ts", oldFilePath: "second.ts" })));
    // The newest read finishes first; the older one lands afterwards.
    completeGitAt(host, core, 1, "abc1234 par1\n");
    for (const index of [2, 3, 4]) completeGitAt(host, core, index, "second\n");
    completeGitAt(host, core, 0, "abc1234 par1\n");
    for (const index of [5, 6, 7]) completeGitAt(host, core, index, "first\n");

    const replies = host.sent
      .map(([, message]) => message as { command: string; newContent?: string | null })
      .filter((message) => message.command === "fullDiffContent");
    expect(replies).toEqual([expect.objectContaining({ newContent: "second\n" })]);
  });

  it("names both paths of a renamed file across a comparison", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({
      fromHash: "aaa1111",
      toHash: "bbb2222",
      oldFilePath: "old.ts",
      newFilePath: "new.ts",
      type: "R",
    })));

    // A comparison names its own old side, so no parent has to be resolved.
    expect(host.gitRequests[0].args).toEqual([
      "diff", "--no-color", "--no-ext-diff", "-M", "aaa1111", "bbb2222", "--", "old.ts", "new.ts",
    ]);
    expect(host.gitRequests[1].args).toEqual(["show", "aaa1111:old.ts"]);
    expect(host.gitRequests[2].args).toEqual(["show", "bbb2222:new.ts"]);
  });

  it("reports a file as unreadable when its diff fails", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest()));
    completeGitAt(host, core, 0, "abc1234 par1\n");
    completeGitAt(host, core, 1, "", 128);
    completeGitAt(host, core, 2, "old\n");
    completeGitAt(host, core, 3, "new\n");

    expect(fullDiffReply(host)).toMatchObject({ diff: null });
  });

  it("answers a non-diffable revision without asking Git", () => {
    // The panel waits for this reply, so the synthetic uncommitted row still
    // has to be answered rather than dropped.
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({ fromHash: "*", toHash: "*" })));

    expect(host.gitRequests).toHaveLength(0);
    expect(fullDiffReply(host)).toMatchObject({ diff: null, oldExists: false, newExists: false });
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

function completeGitAt(
  host: StubHost,
  core: CommitsCore,
  index: number,
  stdout: string,
  exitCode = 0,
): void {
  const request = host.gitRequests[index];
  if (request === undefined) throw new Error(`missing git request ${index}`);
  core.receiveGitResult({
    requestId: request.requestId,
    status: "completed",
    exitCode,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
  });
}

/** Fails a request the way the native service reports a Git error. */
function failGitAt(host: StubHost, core: CommitsCore, index: number, stderr: string): void {
  const request = host.gitRequests[index];
  if (request === undefined) throw new Error(`missing git request ${index}`);
  core.receiveGitResult({
    requestId: request.requestId,
    status: "completed",
    exitCode: 128,
    stdout: new Uint8Array(),
    stderr: new TextEncoder().encode(stderr),
  });
}

/** One file of one commit, which is what a single click in the file tree sends. */
function fullDiffRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command: "fullDiffContent",
    repo: "C:/repo",
    fromHash: "abc1234",
    toHash: "abc1234",
    oldFilePath: "src/a.ts",
    newFilePath: "src/a.ts",
    type: "M",
    ...overrides,
  };
}

function fullDiffReply(host: StubHost): unknown {
  return host.sent
    .map(([, message]) => message as { command: string })
    .find((message) => message.command === "fullDiffContent");
}
