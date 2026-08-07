import { describe, expect, it } from "vitest";
import type { GitResult, GitRun, NativeResult, OsAction, UpdaterAction } from "@commits/ipc/native";
import { CommitsCore } from "./commits-core";
import type { CommitsRepoStatus, HostPort, InstallStatus, LogLevel, PageSource, SettingsIoResult } from "./host/host-port";

class StubHost implements HostPort {
  readonly closed: string[] = [];
  readonly logs: Array<[LogLevel, string]> = [];
  readonly opened: Array<[string, PageSource]> = [];
  readonly sent: Array<[string, unknown]> = [];
  readonly topics: string[] = [];
  readonly osRequests: unknown[] = [];
  readonly gitRequests: GitRun[] = [];
  readonly updateRequests: Array<{ requestId: number; action: UpdaterAction; manifestUrl: string }> = [];
  readonly promptReplies: string[] = [];
  savedState: Uint8Array<ArrayBufferLike> = new Uint8Array();
  settingsBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  settingsSaveError = "";
  paths: string[] = [];
  pageSource: PageSource = { kind: "url", value: "file:///commits/page.html" };
  commitsRepoStatusValue: CommitsRepoStatus =
    { ok: true, exists: false, path: "C:/commits/repo", parentPath: "C:/commits", error: "" };
  installStatusValue: InstallStatus = { ok: true, installed: true, version: "0.2.0", error: "" };

  closePanel(panel: string): void { this.closed.push(panel); }
  log(level: LogLevel, message: string): void { this.logs.push([level, message]); }
  openPanel(panel: string, source: PageSource): void { this.opened.push([panel, source]); }
  repositoryPaths(): readonly string[] { return this.paths; }
  loadPageSource(): PageSource { return this.pageSource; }
  loadSettings(): SettingsIoResult { return { ok: true, value: this.settingsBytes, error: "" }; }
  saveSettings(value: Uint8Array<ArrayBufferLike>): SettingsIoResult {
    if (this.settingsSaveError) return { ok: false, value: new Uint8Array(), error: this.settingsSaveError };
    this.settingsBytes = value;
    return { ok: true, value: new Uint8Array(), error: "" };
  }
  loadSavedState(): Uint8Array<ArrayBufferLike> { return this.savedState; }
  commitsRepoStatus(): CommitsRepoStatus { return this.commitsRepoStatusValue; }
  saveSavedState(value: Uint8Array<ArrayBufferLike>): void { this.savedState = value; }
  runGit(request: GitRun): void { this.gitRequests.push(request); }
  respondPrompt(id: string, value: string): void { this.promptReplies.push(`${id}:${value}`); }
  requestOs(requestId: number, action: OsAction, value?: string): void {
    this.osRequests.push({ requestId, action, value });
  }
  requestUpdate(requestId: number, action: UpdaterAction, manifestUrl: string): void {
    this.updateRequests.push({ requestId, action, manifestUrl });
  }
  installStatus(): InstallStatus { return this.installStatusValue; }
  sendPageMessage(panel: string, message: unknown): void { this.sent.push([panel, message]); }
  subscribe(topic: string): void { this.topics.push(topic); }
}

describe("CommitsCore MIT webview host", () => {
  it("opens the shared graph page and subscribes to native results", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);

    core.start();

    expect(host.opened).toEqual([["main", { kind: "url", value: "file:///commits/page.html" }]]);
    expect(host.topics).toEqual(["web/*", "os/result", "os/prompt", "git/completed", "updater/completed"]);
  });

  it("boots the shared repository selector from host repositories", () => {
    const host = new StubHost();
    host.paths = ["C:\\repo"];
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "loadRepos",
      repos: { "C:/repo": { columnWidths: null } },
      lastActiveRepo: "C:/repo",
    }]);
  });

  it("reports the commits repo status once the view is ready", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: true, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneCommitsRepoStatus",
      exists: true,
      path: "C:/home/.commits/repo",
      message: "",
    }]);
  });

  it("reports the commits repo as absent when the host cannot resolve it", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue = { ok: false, exists: false, path: "", parentPath: "", error: "no home directory" };
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneCommitsRepoStatus",
      exists: false,
      path: "",
      message: "",
    }]);
  });

  it("clones the commits repo into the reported path when it does not exist yet", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: false, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));

    expect(host.gitRequests).toHaveLength(1);
    expect(host.gitRequests[0].cwd).toBe("C:/home/.commits");
    expect(host.gitRequests[0].args).toEqual([
      "clone", "https://github.com/an-dr/commits.git", "C:/home/.commits/repo",
    ]);

    completeGitAt(host, core, 0, "");

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneCommitsRepoStatus",
      exists: true,
      path: "C:/home/.commits/repo",
      message: "Cloned to C:/home/.commits/repo",
    }]);
  });

  it("ignores a repeat clone request while one is already in flight", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: false, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));

    expect(host.gitRequests).toHaveLength(1);

    completeGitAt(host, core, 0, "");
    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));

    // Once the first clone has finished, a further click is the "already
    // cloned" no-op path, not a second clone.
    expect(host.gitRequests).toHaveLength(1);
  });

  it("no-ops the clone with a message when the repo already exists", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: true, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));

    expect(host.gitRequests).toHaveLength(0);
    expect(host.sent).toContainEqual(["main", {
      command: "standaloneCommitsRepoStatus",
      exists: true,
      path: "C:/home/.commits/repo",
      message: "Already cloned at C:/home/.commits/repo",
    }]);
  });

  it("reports a failed clone with git's own error", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: false, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneCloneCommitsRepo" }));

    failGitAt(host, core, 0, "fatal: unable to access the remote\n");

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneCommitsRepoStatus",
      exists: false,
      path: "C:/home/.commits/repo",
      message: "Clone failed: fatal: unable to access the remote",
    }]);
  });

  it("opens the commits repo once it exists", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: true, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneOpenCommitsRepo" }));

    expect(host.sent).toContainEqual(["main", {
      command: "loadRepos",
      repos: { "C:/home/.commits/repo": { columnWidths: null } },
      lastActiveRepo: "C:/home/.commits/repo",
    }]);
  });

  it("does nothing when asked to open the commits repo before it is cloned", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: false, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneOpenCommitsRepo" }));

    expect(host.sent.some(([, message]) => (message as { command?: string }).command === "loadRepos"))
      .toBe(false);
  });

  it("reveals the commits repo folder once it exists", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: true, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneOpenCommitsRepoFolder" }));

    expect(host.osRequests).toContainEqual({
      requestId: 50_000, action: "reveal-directory", value: "C:/home/.commits/repo",
    });
  });

  it("does nothing when asked to reveal the commits repo folder before it is cloned", () => {
    const host = new StubHost();
    host.commitsRepoStatusValue =
      { ok: true, exists: false, path: "C:/home/.commits/repo", parentPath: "C:/home/.commits", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneOpenCommitsRepoFolder" }));

    expect(host.osRequests).toHaveLength(0);
  });

  it("checks for an update at boot when a manifest URL is configured", () => {
    const host = new StubHost();
    host.settingsBytes = new TextEncoder().encode(JSON.stringify({
      version: 2,
      core: {},
      app: { mode: "dark", lightTheme: "paper", darkTheme: "graphite", updateManifestUrl: "https://example.com/manifest.json" },
    }));
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.updateRequests).toEqual([
      { requestId: 70_000, action: "check", manifestUrl: "https://example.com/manifest.json" },
    ]);
  });

  it("does not check for updates when no manifest URL is configured", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.updateRequests).toHaveLength(0);
  });

  it("announces an available update once the check finds a newer version", () => {
    const host = new StubHost();
    host.settingsBytes = new TextEncoder().encode(JSON.stringify({
      version: 2,
      core: {},
      app: { mode: "dark", lightTheme: "paper", darkTheme: "graphite", updateManifestUrl: "https://example.com/manifest.json" },
    }));
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receiveUpdaterResult({
      requestId: host.updateRequests[0].requestId,
      ok: true,
      available: true,
      fresh: false,
      version: "9.9.9",
      error: "",
    });

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneUpdateStatus",
      available: true,
      version: "9.9.9",
      ready: false,
      message: "Update 9.9.9 available",
    }]);
  });

  it("stages the update on standaloneStartUpdate and reports readiness once staged", () => {
    const host = new StubHost();
    host.settingsBytes = new TextEncoder().encode(JSON.stringify({
      version: 2,
      core: {},
      app: { mode: "dark", lightTheme: "paper", darkTheme: "graphite", updateManifestUrl: "https://example.com/manifest.json" },
    }));
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receiveUpdaterResult({
      requestId: host.updateRequests[0].requestId,
      ok: true,
      available: true,
      fresh: false,
      version: "9.9.9",
      error: "",
    });

    core.receivePageJson(JSON.stringify({ command: "standaloneStartUpdate" }));

    expect(host.updateRequests).toHaveLength(2);
    expect(host.updateRequests[1]).toEqual({
      requestId: 70_001, action: "stage", manifestUrl: "https://example.com/manifest.json",
    });

    core.receiveUpdaterResult({ requestId: 70_001, ok: true, available: true, fresh: false, version: "9.9.9", error: "" });

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneUpdateStatus",
      available: true,
      version: "9.9.9",
      ready: true,
      message: "Update 9.9.9 ready — restart to apply",
    }]);
  });

  it("ignores standaloneStartUpdate when no update is available", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneStartUpdate" }));

    expect(host.updateRequests).toHaveLength(0);
  });

  it("reports install status and version at boot, independent of any manifest URL", () => {
    const host = new StubHost();
    host.installStatusValue = { ok: true, installed: false, version: "0.2.0", error: "" };
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneInstallStatus", status: "ready", version: "0.2.0", message: "",
    }]);
  });

  it("stages the running build on standaloneInstall and reports readiness once an existing launcher will apply it", () => {
    const host = new StubHost();
    host.installStatusValue = { ok: true, installed: false, version: "0.2.0", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneInstall" }));

    expect(host.updateRequests).toEqual([{ requestId: 70_000, action: "install", manifestUrl: "" }]);
    expect(host.sent).toContainEqual(["main", {
      command: "standaloneInstallStatus", status: "ready", version: "0.2.0", message: "Installing…",
    }]);

    core.receiveUpdaterResult({ requestId: 70_000, ok: true, available: true, fresh: false, version: "", error: "" });

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneInstallStatus",
      status: "staged",
      version: "0.2.0",
      message: "Installed — restart commits.exe to apply.",
    }]);
  });

  it("reports completion directly when nothing was installed and the files landed in place", () => {
    const host = new StubHost();
    host.installStatusValue = { ok: true, installed: false, version: "0.2.0", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneInstall" }));

    core.receiveUpdaterResult({ requestId: 70_000, ok: true, available: true, fresh: true, version: "", error: "" });

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneInstallStatus",
      status: "done",
      version: "0.2.0",
      message: "Installed to ~/.commits/app — launch commits.exe to use it.",
    }]);
  });

  it("ignores standaloneInstall once already installed", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({ command: "standaloneInstall" }));

    expect(host.updateRequests).toHaveLength(0);
  });

  it("reports a failed install without losing the not-installed state", () => {
    const host = new StubHost();
    host.installStatusValue = { ok: true, installed: false, version: "0.2.0", error: "" };
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneInstall" }));

    core.receiveUpdaterResult({ requestId: 70_000, ok: false, available: false, fresh: false, version: "", error: "disk full" });

    expect(host.sent).toContainEqual(["main", {
      command: "standaloneInstallStatus", status: "ready", version: "0.2.0", message: "Install failed: disk full",
    }]);
  });

  it("loads settings before repository messages and acknowledges atomic saves", () => {
    const host = new StubHost();
    host.settingsBytes = new TextEncoder().encode(JSON.stringify({
      version: 2,
      core: { "an-dr-com-mit-s.uiDensity": "Compact" },
      app: { mode: "dark", lightTheme: "paper", darkTheme: "graphite" },
    }));
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    expect(host.sent).toContainEqual(["main", expect.objectContaining({
      command: "standaloneSettings",
      settings: expect.objectContaining({ app: expect.objectContaining({ mode: "dark" }) }),
    })]);

    core.receivePageJson(JSON.stringify({
      command: "standaloneSaveSettings",
      requestId: 7,
      settings: { version: 2, core: {}, app: { mode: "light" } },
    }));
    expect(new TextDecoder().decode(host.settingsBytes)).toContain('"mode": "light"');
    expect(host.sent).toContainEqual(["main", expect.objectContaining({
      command: "standaloneSettingsSaved", requestId: 7, error: "",
    })]);
  });

  it("keeps active settings when a save fails", () => {
    const host = new StubHost();
    host.settingsSaveError = "disk full";
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({
      command: "standaloneSaveSettings",
      requestId: 8,
      settings: { version: 2, core: {}, app: { mode: "dark" } },
    }));

    expect(host.sent).toContainEqual(["main", expect.objectContaining({
      command: "standaloneSettingsSaved",
      requestId: 8,
      settings: expect.objectContaining({ app: expect.objectContaining({ mode: "system" }) }),
      error: "disk full",
    })]);
  });

  it("asks Bones for a folder when no repository is available", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);

    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));
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
    core.receivePageJson(JSON.stringify({ command: "standaloneViewReady" }));

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

  it("runs a working-tree action and answers its outcome", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "stageFiles", repo: "C:/repo", files: ["src/a.ts"],
    }));

    expect(host.gitRequests[0].args).toEqual(["add", "--", "src/a.ts"]);
    completeGitAt(host, core, 0, "");
    expect(host.sent).toContainEqual(["main", { command: "stageFiles", status: null }]);
  });

  it("commits the staged changes with the message it was given", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "commitChanges", repo: "C:/repo", message: "  fix: the thing  ", amend: true,
    }));

    // No editor can open: the message is an argument and it is trimmed here.
    expect(host.gitRequests[0].args).toEqual([
      "commit", "--amend", "--message", "fix: the thing",
    ]);
    completeGitAt(host, core, 0, "");
    expect(host.sent).toContainEqual(["main", { command: "commitChanges", status: null }]);
  });

  it("refuses to commit without a message rather than opening an editor", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify({
      command: "commitChanges", repo: "C:/repo", message: "", amend: false,
    }));

    expect(host.gitRequests).toHaveLength(0);
    expect(host.sent).toContainEqual([
      "main", { command: "commitChanges", status: "A commit needs a message." },
    ]);
  });

  it("still refuses a Git action it does not implement", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({ command: "mergeBranch", repo: "C:/repo" }));

    const reply = host.sent
      .map(([, message]) => message as { command: string; status?: string | null })
      .find((message) => message.command === "mergeBranch");
    expect(reply?.status).toContain("not available in the standalone host yet");
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

  it("diffs an unstaged file against the index and the working tree", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({
      fromHash: "*", toHash: "*", staged: false,
    })));

    expect(host.gitRequests[0].args).toEqual([
      "diff", "--no-color", "--no-ext-diff", "-M", "--", "src/a.ts",
    ]);
    expect(host.gitRequests[1].args).toEqual(["show", ":src/a.ts"]);
    completeGitAt(host, core, 0, "@@ -1 +1 @@\n-indexed\n+on disk\n");
    completeGitAt(host, core, 1, "indexed\n");

    // Only the working tree needs the host: Git cannot print a file on disk.
    expect(host.osRequests).toEqual([
      { requestId: 50_000, action: "read-file", value: "C:/repo\nsrc/a.ts" },
    ]);
    core.receiveOsResult({ requestId: 50_000, accepted: true, value: "on disk\n", error: "" });

    expect(fullDiffReply(host)).toEqual({
      command: "fullDiffContent",
      diff: "@@ -1 +1 @@\n-indexed\n+on disk\n",
      oldContent: "indexed\n",
      newContent: "on disk\n",
      oldExists: true,
      newExists: true,
    });
  });

  it("diffs a staged file between HEAD and the index without leaving Git", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({
      fromHash: "*", toHash: "*", staged: true,
    })));

    expect(host.gitRequests[0].args).toContain("--cached");
    expect(host.gitRequests[1].args).toEqual(["show", "HEAD:src/a.ts"]);
    expect(host.gitRequests[2].args).toEqual(["show", ":src/a.ts"]);
    completeGitAt(host, core, 0, "@@ -1 +1 @@\n-committed\n+staged\n");
    completeGitAt(host, core, 1, "committed\n");
    completeGitAt(host, core, 2, "staged\n");

    expect(host.osRequests).toEqual([]);
    expect(fullDiffReply(host)).toMatchObject({
      oldContent: "committed\n",
      newContent: "staged\n",
    });
  });

  it("reports no working-tree side when the file cannot be read", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({ fromHash: "*", toHash: "*" })));
    completeGitAt(host, core, 0, "@@ -1 +0,0 @@\n-gone\n");
    completeGitAt(host, core, 1, "gone\n");
    core.receiveOsResult({ requestId: 50_000, accepted: false, value: "", error: "" });

    expect(fullDiffReply(host)).toMatchObject({ newExists: false, newContent: null });
  });

  it("answers a non-diffable revision without asking Git", () => {
    // The panel waits for this reply, so a revision that is neither a commit
    // nor the working tree still has to be answered rather than dropped.
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));
    core.receivePageJson(JSON.stringify({ command: "selectRepo", repo: "C:/repo" }));

    core.receivePageJson(JSON.stringify(fullDiffRequest({
      fromHash: "refs/heads/main", toHash: "refs/heads/main",
    })));

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

  it("requests a Gravatar fetch-url and delivers the image as a data URI", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({
      command: "fetchAvatar", repo: "C:/repo", email: "MyEmailAddress@example.com", commits: ["abc1234"],
    }));

    expect(host.osRequests).toEqual([{
      requestId: 50_000,
      action: "fetch-url",
      value: "https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=80&d=404",
    }]);

    core.receiveOsResult({ requestId: 50_000, accepted: true, value: "image/jpeg;base64,/9j/", error: "" });

    expect(host.sent).toContainEqual(["main", {
      command: "fetchAvatar",
      email: "MyEmailAddress@example.com",
      image: "data:image/jpeg;base64,/9j/",
    }]);
  });

  it("sends nothing for a fetchAvatar request with no Gravatar for that address", () => {
    const host = new StubHost();
    const core = new CommitsCore(host);
    core.receivePageJson(JSON.stringify({ command: "standaloneReady" }));

    core.receivePageJson(JSON.stringify({
      command: "fetchAvatar", repo: "C:/repo", email: "nobody@example.com", commits: [],
    }));
    core.receiveOsResult({ requestId: 50_000, accepted: false, value: "", error: "" });

    expect(host.sent.some(([, message]) => (message as { command?: string }).command === "fetchAvatar"))
      .toBe(false);
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
