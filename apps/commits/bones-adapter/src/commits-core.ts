import type { GitFileChangeType } from "@an-dr/commits-core/backend/types";
import type { RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";
import { encodeFileRead, type GitResult, type NativeResult, type UpdaterResult } from "@commits/ipc/native";
import { gravatarUrl } from "./gravatar";
import type { HostPort } from "./host/host-port";
import { CommitsCoreWorkspacePort } from "./host/commits-core-workspace-port";
import { MitGraphBackend } from "./mit/graph-backend";
import { WorkingTreeActions } from "./mit/working-tree-actions";
import { RepositoryManager } from "./read/repository-manager";
import {
  DEFAULT_PERSISTENT_STATE,
  MAX_RECENT_REPOSITORIES,
  PersistentExtensionState,
  type PersistentState,
} from "./read/persistent-state";
import { DEFAULT_SETTINGS, parseSettings, validateSettings, type SettingsDocument } from "./read/settings";

const PANEL = "main";

/** The commits project's own repository, cloned locally for Commits Repo menu actions. */
const COMMITS_REPO_REMOTE_URL = "https://github.com/an-dr/commits.git";

type StandaloneRequest =
  | { readonly command: "standaloneReady" }
  | { readonly command: "standaloneViewReady" }
  | { readonly command: "standaloneChooseRepository" }
  | { readonly command: "standaloneOpenRepository"; readonly path: string }
  | { readonly command: "standaloneSaveSettings"; readonly requestId: number; readonly settings: unknown }
  | { readonly command: "standaloneCloneCommitsRepo" }
  | { readonly command: "standaloneOpenCommitsRepo" }
  | { readonly command: "standaloneOpenCommitsRepoFolder" }
  | { readonly command: "standaloneStartUpdate" }
  | { readonly command: "standaloneInstall" };

type PendingOs =
  | { readonly kind: "chooseRepository" }
  | { readonly kind: "copy"; readonly type: string }
  | { readonly kind: "openExternalUrl" }
  | { readonly kind: "revealCommitsRepoFolder" }
  | { readonly kind: "readFile"; readonly deliver: (content: string | null) => void }
  | { readonly kind: "fetchAvatar"; readonly email: string };

/** Bones owner of the unchanged MIT webview's host protocol. */
export class CommitsCore {
  private readonly repositories: RepositoryManager;
  private readonly persistent: PersistentExtensionState;
  private readonly graph: MitGraphBackend;
  private readonly workingTreeActions: WorkingTreeActions;
  private readonly pendingOs = new Map<number, PendingOs>();
  private state: PersistentState = DEFAULT_PERSISTENT_STATE;
  private settings: SettingsDocument = DEFAULT_SETTINGS;
  private settingsError = "";
  private currentRepository: string | null = null;
  private commitsRepoPath: string | null = null;
  private commitsRepoParentPath: string | null = null;
  private commitsRepoExists = false;
  private pendingCloneRequestId: number | null = null;
  private pendingUpdateCheckRequestId: number | null = null;
  private pendingUpdateStageRequestId: number | null = null;
  private pendingInstallRequestId: number | null = null;
  /** Set once `check` finds a version newer than this build's own. */
  private updateAvailableVersion: string | null = null;
  /**
   * Whether this run's own directory is the canonical install location.
   * Defaults to `true` so the Install entry stays hidden until `bootstrap`
   * proves otherwise, rather than flashing on for every boot.
   */
  private installed = true;
  private bootstrapped = false;
  private nextOsRequestId = 50_000;
  private nextGitRequestId = 60_000;
  private nextUpdateRequestId = 70_000;
  /** Counts panel file reads so only the newest one answers. */
  private fullDiffSequence = 0;
  /** Counts comparisons so only the newest selection answers. */
  private comparisonSequence = 0;

  constructor(private readonly host: HostPort) {
    const storage = {
      load: () => host.loadSavedState(),
      save: (value: Uint8Array<ArrayBufferLike>) => host.saveSavedState(value),
    };
    this.repositories = new RepositoryManager(new CommitsCoreWorkspacePort(host));
    this.persistent = new PersistentExtensionState(storage);
    this.graph = new MitGraphBackend(host, (repo, path, deliver) =>
      this.readWorkingTreeFile(repo, path, deliver),
    );
    this.workingTreeActions = new WorkingTreeActions(host);
  }

  /**
   * Reads one working-tree file through the host, which confines the read to
   * the repository. An unreadable file is answered as absent, the same as Git
   * answers a blob it does not have.
   */
  private readWorkingTreeFile(
    repo: string,
    path: string,
    deliver: (content: string | null) => void,
  ): void {
    const requestId = this.nextOsRequestId++;
    this.pendingOs.set(requestId, { kind: "readFile", deliver });
    this.host.requestOs(requestId, "read-file", encodeFileRead(repo, path));
  }

  start(): void {
    this.host.subscribe("web/*");
    this.host.subscribe("os/result");
    this.host.subscribe("os/prompt");
    this.host.subscribe("git/completed");
    this.host.subscribe("updater/completed");
    // Fetched here rather than at construction so the request reaches a running
    // host instead of the build-time snapshot taken while componentizing.
    this.host.openPanel(PANEL, this.host.loadPageSource());
    this.host.log("info", "MIT commits graph panel requested");
  }

  stop(): void {
    this.host.closePanel(PANEL);
  }

  receivePageJson(json: string): void {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      this.host.log("warn", "ignored malformed page JSON");
      return;
    }
    if (!isRecord(value) || typeof value.command !== "string") {
      this.host.log("warn", "ignored unknown page request");
      return;
    }

    // The shared view begins querying as soon as it mounts, which is before the
    // standalone page reports readiness. Bootstrapping on the first message of
    // any kind keeps those early queries answerable instead of dropped.
    this.ensureBootstrapped();

    switch (value.command) {
      case "standaloneReady":
        this.send({ command: "standaloneSettings", settings: this.settings, error: this.settingsError });
        return;
      case "standaloneViewReady":
        this.sendCurrentRepositories();
        this.sendCommitsRepoStatus();
        return;
      case "standaloneSaveSettings":
        this.saveSettings(value.requestId, value.settings);
        return;
      case "standaloneChooseRepository":
        this.chooseRepository();
        return;
      case "standaloneOpenRepository":
        if (typeof value.path === "string") this.openRepository(value.path);
        return;
      case "standaloneCloneCommitsRepo":
        this.cloneCommitsRepo();
        return;
      case "standaloneOpenCommitsRepo":
        this.openCommitsRepo();
        return;
      case "standaloneOpenCommitsRepoFolder":
        this.revealCommitsRepoFolder();
        return;
      case "standaloneStartUpdate":
        this.startUpdate();
        return;
      case "standaloneInstall":
        this.startInstall();
        return;
      case "loadRepos":
        this.sendRepos();
        return;
      case "selectRepo":
        if (typeof value.repo === "string") this.selectRepository(value.repo);
        return;
      case "saveRepoState":
        return;
      case "loadBranches":
        if (this.currentRepository !== null) {
          this.graph.loadBranches(
            {
              command: "loadBranches",
              repo: this.currentRepository,
              showRemoteBranches: value.showRemoteBranches !== false,
              hard: value.hard === true,
            },
            (response) => this.send(response),
          );
        }
        return;
      case "loadCommits":
        if (typeof value.repo === "string") this.selectRepository(value.repo, false);
        if (this.currentRepository !== null) {
          this.graph.loadCommits(
            {
              command: "loadCommits",
              repo: this.currentRepository,
              branchName: typeof value.branchName === "string" ? value.branchName : "",
              branches: Array.isArray(value.branches)
                ? value.branches.filter((branch): branch is string => typeof branch === "string")
                : undefined,
              maxCommits: typeof value.maxCommits === "number" ? value.maxCommits : 300,
              showRemoteBranches: value.showRemoteBranches !== false,
              hard: value.hard === true,
            },
            (response) => this.send(response),
          );
        }
        return;
      case "commitDetails":
        if (this.currentRepository !== null && typeof value.commitHash === "string") {
          this.graph.loadCommitDetails(
            {
              command: "commitDetails",
              repo: this.currentRepository,
              commitHash: value.commitHash,
            },
            (response) => this.send(response),
          );
        }
        return;
      case "commitChanges":
        this.workingTreeActions.commit(
          this.currentRepository ?? "",
          {
            message: asString(value.message),
            amend: value.amend === true,
          },
          (status) => this.send({ command: "commitChanges", status }),
        );
        return;
      case "stageFiles":
      case "unstageFiles":
      case "discardFiles": {
        const files = Array.isArray(value.files)
          ? value.files.filter((file): file is string => typeof file === "string")
          : [];
        this.workingTreeActions.run(
          this.currentRepository ?? "",
          value.command === "discardFiles"
            ? { command: "discardFiles", files, untracked: value.untracked === true }
            : { command: value.command, files },
          (status) => this.send({ command: value.command as string, status }),
        );
        return;
      }
      case "workingTreeChanges":
        this.graph.loadWorkingTreeChanges(
          { command: "workingTreeChanges", repo: this.currentRepository ?? "" },
          (response) => this.send(response),
        );
        return;
      case "commitComparison": {
        // Changing the selection supersedes the previous comparison the same
        // way a second file click supersedes the first.
        const sequence = ++this.comparisonSequence;
        this.graph.loadComparison(
          {
            command: "commitComparison",
            repo: this.currentRepository ?? "",
            fromHash: asString(value.fromHash),
            toHash: asString(value.toHash),
          },
          (response) => {
            if (sequence === this.comparisonSequence) this.send(response);
          },
        );
        return;
      }
      case "fullDiffContent": {
        // The page names no file in its reply, so a slower earlier read would
        // land under the filename of the file clicked after it. Only the newest
        // request may answer. The panel waits on that reply, so an unusable
        // request is answered with the unreadable outcome rather than dropped.
        const sequence = ++this.fullDiffSequence;
        this.graph.loadFullDiff(
          {
            command: "fullDiffContent",
            repo: this.currentRepository ?? "",
            fromHash: asString(value.fromHash),
            toHash: asString(value.toHash),
            oldFilePath: asString(value.oldFilePath),
            newFilePath: asString(value.newFilePath),
            type: asFileChangeType(value.type),
            staged: value.staged === true,
          },
          (response) => {
            if (sequence === this.fullDiffSequence) this.send(response);
          },
        );
        return;
      }
      case "repoInProgress":
        this.send({ command: "repoInProgress", state: null });
        return;
      case "copyToClipboard":
        if (typeof value.data === "string" && typeof value.type === "string") {
          const requestId = this.nextOsRequestId++;
          this.pendingOs.set(requestId, { kind: "copy", type: value.type });
          this.host.requestOs(requestId, "clipboard-write", value.data);
        }
        return;
      case "openExternalUrl":
        if (typeof value.url === "string") {
          const requestId = this.nextOsRequestId++;
          this.pendingOs.set(requestId, { kind: "openExternalUrl" });
          this.host.requestOs(requestId, "open-url", value.url);
        }
        return;
      case "getRelativeTimeDiff":
        this.send({ command: "getRelativeTimeDiff", value: "" });
        return;
      case "fetchAvatar":
        if (typeof value.email === "string" && value.email) {
          const requestId = this.nextOsRequestId++;
          this.pendingOs.set(requestId, { kind: "fetchAvatar", email: value.email });
          this.host.requestOs(requestId, "fetch-url", gravatarUrl(value.email));
        }
        return;
      default:
        if (isMutationCommand(value.command)) {
          this.send({ command: value.command, status: "This Git action is not available in the standalone host yet." });
        } else {
          this.host.log("debug", `ignored unsupported MIT view command: ${value.command}`);
        }
    }
  }

  receiveOsResult(result: NativeResult): void {
    const pending = this.pendingOs.get(result.requestId);
    if (pending === undefined) return;
    this.pendingOs.delete(result.requestId);
    if (pending.kind === "readFile") {
      if (result.error) this.host.log("warn", result.error);
      pending.deliver(result.accepted ? result.value : null);
    } else if (pending.kind === "chooseRepository") {
      if (result.accepted && result.value) this.openRepository(result.value);
      else if (result.error) this.host.log("warn", result.error);
    } else if (pending.kind === "copy") {
      this.send({ command: "copyToClipboard", type: pending.type, success: result.accepted });
    } else if (pending.kind === "revealCommitsRepoFolder") {
      if (!result.accepted) {
        this.sendCommitsRepoStatus(`Could not open the folder: ${result.error || "unknown error"}`);
      }
    } else if (pending.kind === "fetchAvatar") {
      // A rejected result covers both "no Gravatar for this address" (a plain
      // 404, reported with no error text) and a real fetch failure; either
      // way, sending nothing lets the page's own procedural-avatar/initials
      // fallback take over exactly as it already does before any response
      // arrives.
      if (result.accepted && result.value) {
        this.send({ command: "fetchAvatar", email: pending.email, image: `data:${result.value}` });
      } else if (result.error) {
        this.host.log("warn", result.error);
      }
    } else {
      this.send({ command: "openExternalUrl", error: result.accepted ? null : result.error || "Unable to open URL" });
    }
  }

  receiveGitResult(result: GitResult): void {
    if (result.requestId === this.pendingCloneRequestId) {
      this.pendingCloneRequestId = null;
      this.finishCloneCommitsRepo(result);
      return;
    }
    this.graph.receive(result);
    this.workingTreeActions.receive(result);
  }

  receiveUpdaterResult(result: UpdaterResult): void {
    if (result.requestId === this.pendingUpdateCheckRequestId) {
      this.pendingUpdateCheckRequestId = null;
      if (result.ok && result.available) {
        this.updateAvailableVersion = result.version;
        this.sendUpdateStatus(`Update ${result.version} available`);
      } else if (!result.ok) {
        this.host.log("warn", `update check failed: ${result.error}`);
      }
      return;
    }
    if (result.requestId === this.pendingUpdateStageRequestId) {
      this.pendingUpdateStageRequestId = null;
      if (result.ok) {
        this.sendUpdateStatus(`Update ${result.version} ready — restart to apply`, true);
      } else {
        // The available update is still there to retry; only the attempt failed.
        this.sendUpdateStatus(`Update failed: ${result.error || "unknown error"}`);
      }
      return;
    }
    if (result.requestId === this.pendingInstallRequestId) {
      this.pendingInstallRequestId = null;
      if (result.ok) {
        this.sendInstallStatus(true, "Installed — restart commits.exe to apply.");
      } else {
        this.sendInstallStatus(false, `Install failed: ${result.error || "unknown error"}`);
      }
    }
  }

  receivePrompt(payload: string): void {
    const [id, kind, ...message] = payload.split("\n");
    if (id && kind) this.send({ command: "standaloneCredentialPrompt", id, kind, message: message.join("\n") });
  }

  panelOpened(): void {
    this.host.log("info", "commits graph panel opened");
  }

  panelClosed(): void {
    this.host.log("info", "commits graph panel closed");
  }

  panelFailed(reason: string): void {
    this.host.log("error", `commits graph panel failed: ${reason}`);
  }

  /** Runs the one-time startup sequence, whatever message triggers it first. */
  private ensureBootstrapped(): void {
    if (this.bootstrapped) return;
    this.bootstrapped = true;
    this.bootstrap();
  }

  /**
   * Tells the page whether ~/.commits/repo exists, so it can enable Open
   * Commits Repo / Open Commits Repo Folder. Sent at boot and again after a
   * clone changes the answer. `message` carries transient feedback about
   * what just happened (cloned, already cloned, or failed); it is empty for
   * the boot-time announcement, which reports state rather than an event.
   */
  private sendCommitsRepoStatus(message = ""): void {
    this.send({
      command: "standaloneCommitsRepoStatus",
      exists: this.commitsRepoExists,
      path: this.commitsRepoPath ?? "",
      message,
    });
  }

  /** Clones the commits project's own repository into ~/.commits/repo. */
  private cloneCommitsRepo(): void {
    // A clone already in flight must not be started twice: a repeat click
    // before the GitResult returns would otherwise spawn a second `git
    // clone` into the same not-yet-populated destination.
    if (this.pendingCloneRequestId !== null) {
      return;
    }
    if (this.commitsRepoExists) {
      this.sendCommitsRepoStatus(`Already cloned at ${this.commitsRepoPath ?? ""}`);
      return;
    }
    if (this.commitsRepoPath === null || this.commitsRepoParentPath === null) {
      this.sendCommitsRepoStatus("Could not resolve the commits repo path");
      return;
    }
    const requestId = this.nextGitRequestId++;
    this.pendingCloneRequestId = requestId;
    this.sendCommitsRepoStatus("Cloning…");
    this.host.runGit({
      requestId,
      cwd: this.commitsRepoParentPath,
      args: ["clone", COMMITS_REPO_REMOTE_URL, this.commitsRepoPath],
      timeoutMs: 120_000,
    });
  }

  /** Reacts to the clone's GitResult: updates state and tells the page what happened. */
  private finishCloneCommitsRepo(result: GitResult): void {
    if (result.status === "completed" && result.exitCode === 0) {
      this.commitsRepoExists = true;
      this.sendCommitsRepoStatus(`Cloned to ${this.commitsRepoPath ?? ""}`);
      return;
    }
    this.sendCommitsRepoStatus(`Clone failed: ${summarizeGitFailure(result)}`);
  }

  /** Opens ~/.commits/repo the same way any other repository is opened. */
  private openCommitsRepo(): void {
    if (!this.commitsRepoExists || this.commitsRepoPath === null) return;
    this.openRepository(this.commitsRepoPath);
  }

  /** Reveals ~/.commits/repo in the OS's native file manager. */
  private revealCommitsRepoFolder(): void {
    if (!this.commitsRepoExists || this.commitsRepoPath === null) return;
    const requestId = this.nextOsRequestId++;
    this.pendingOs.set(requestId, { kind: "revealCommitsRepoFolder" });
    this.host.requestOs(requestId, "reveal-directory", this.commitsRepoPath);
  }

  /** Re-announces repository availability without redoing discovery. */
  private sendCurrentRepositories(): void {
    if (this.repositories.all().length === 0) {
      this.send({ command: "standaloneRepositoryRequired", recent: this.state.recentRepositories });
    } else {
      this.sendRepos();
    }
  }

  private bootstrap(): void {
    this.state = this.persistent.load();
    const loaded = this.host.loadSettings();
    if (loaded.ok) {
      const source = loaded.value.length > 0 ? loaded.value : this.host.loadSavedState();
      this.settings = source.length > 0
        ? parseSettings(new TextDecoder().decode(source))
        : DEFAULT_SETTINGS;
    } else {
      this.settingsError = loaded.error;
      this.host.log("warn", `could not load settings: ${loaded.error}`);
    }
    const commitsRepo = this.host.commitsRepoStatus();
    if (commitsRepo.ok) {
      this.commitsRepoPath = commitsRepo.path;
      this.commitsRepoParentPath = commitsRepo.parentPath;
      this.commitsRepoExists = commitsRepo.exists;
    } else {
      this.host.log("warn", `could not resolve the commits repo path: ${commitsRepo.error}`);
    }
    this.repositories.discover();
    if (this.state.lastActiveRepository !== null) {
      this.repositories.addExternal(this.state.lastActiveRepository);
      this.currentRepository = this.state.lastActiveRepository;
    }
    if (this.repositories.all().length > 0) this.currentRepository ??= this.repositories.all()[0].path;
    // An unconfigured URL means self-update is intentionally off, not a
    // transient failure worth reporting.
    if (this.settings.app.updateManifestUrl) this.checkForUpdate();
    const installStatus = this.host.installStatus();
    if (installStatus.ok) {
      this.installed = installStatus.installed;
    } else {
      this.host.log("warn", `could not resolve install status: ${installStatus.error}`);
    }
    this.sendInstallStatus();
  }

  /** Runs once at boot when a manifest URL is configured; see `bootstrap`. */
  private checkForUpdate(): void {
    if (this.pendingUpdateCheckRequestId !== null || !this.settings.app.updateManifestUrl) return;
    const requestId = this.nextUpdateRequestId++;
    this.pendingUpdateCheckRequestId = requestId;
    this.host.requestUpdate(requestId, "check", this.settings.app.updateManifestUrl);
  }

  /** Downloads, verifies, and stages the update `checkForUpdate` found. */
  private startUpdate(): void {
    if (this.updateAvailableVersion === null || this.pendingUpdateStageRequestId !== null) return;
    if (!this.settings.app.updateManifestUrl) return;
    const requestId = this.nextUpdateRequestId++;
    this.pendingUpdateStageRequestId = requestId;
    this.sendUpdateStatus("Downloading update…");
    this.host.requestUpdate(requestId, "stage", this.settings.app.updateManifestUrl);
  }

  private sendUpdateStatus(message: string, ready = false): void {
    this.send({
      command: "standaloneUpdateStatus",
      available: this.updateAvailableVersion !== null,
      version: this.updateAvailableVersion ?? "",
      ready,
      message,
    });
  }

  /** Stages this running build for the next launcher run, regardless of
   * whether self-update via a hosted manifest is configured -- unlike
   * `checkForUpdate`/`startUpdate`, this needs no network at all. */
  private startInstall(): void {
    if (this.installed || this.pendingInstallRequestId !== null) return;
    const requestId = this.nextUpdateRequestId++;
    this.pendingInstallRequestId = requestId;
    this.sendInstallStatus(false, "Installing…");
    this.host.requestUpdate(requestId, "install", "");
  }

  private sendInstallStatus(staged = false, message = ""): void {
    this.send({ command: "standaloneInstallStatus", installed: this.installed, staged, message });
  }

  private saveSettings(requestId: unknown, candidate: unknown): void {
    const settings = validateSettings(candidate);
    const bytes = new TextEncoder().encode(`${JSON.stringify(settings, null, 2)}\n`);
    const saved = this.host.saveSettings(bytes);
    if (saved.ok) {
      this.settings = settings;
      this.settingsError = "";
    }
    this.send({
      command: "standaloneSettingsSaved",
      requestId: Number.isSafeInteger(requestId) ? requestId : 0,
      settings: this.settings,
      error: saved.error,
    });
  }

  private chooseRepository(): void {
    const requestId = this.nextOsRequestId++;
    this.pendingOs.set(requestId, { kind: "chooseRepository" });
    this.host.requestOs(requestId, "pick-folder");
  }

  private openRepository(path: string): void {
    const repository = this.repositories.addExternal(path);
    if (repository === null) return;
    this.selectRepository(repository.path);
    this.sendRepos();
  }

  private selectRepository(path: string, persist = true): void {
    this.currentRepository = path;
    if (persist) {
      this.state = this.persistent.save({
        ...this.state,
        lastActiveRepository: path,
        recentRepositories: withMostRecent(this.state.recentRepositories, path),
      });
    }
  }

  private sendRepos(): void {
    const repos: Record<string, { columnWidths: number[] | null }> = {};
    for (const repository of this.repositories.all()) repos[repository.path] = { columnWidths: null };
    this.send({ command: "loadRepos", repos, lastActiveRepo: this.currentRepository });
  }

  private send(message: ResponseMessage | Record<string, unknown>): void {
    this.host.sendPageMessage(PANEL, message);
  }
}

/** Puts a path at the head of the recent list, bounded and deduplicated. */
function withMostRecent(recent: readonly string[], path: string): readonly string[] {
  return [path, ...recent.filter((entry) => entry !== path)].slice(0, MAX_RECENT_REPOSITORIES);
}

/** A short, human-readable reason a git run failed, for a one-line status message. */
function summarizeGitFailure(result: GitResult): string {
  const stderr = new TextDecoder().decode(result.stderr).trim();
  const firstLine = stderr.split("\n").find((line) => line.trim() !== "");
  if (firstLine) return firstLine.trim();
  if (result.status === "cancelled") return "cancelled";
  return `git exited with code ${result.exitCode}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Change kind of a file, defaulting to a modification: that reads both
 * endpoints, which is the safe assumption for an unrecognised kind.
 */
function asFileChangeType(value: unknown): GitFileChangeType {
  const letter = asString(value).toUpperCase();
  return letter === "A" || letter === "D" || letter === "R" ? letter : "M";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMutationCommand(command: string): command is RequestMessage["command"] {
  return [
    "addTag", "deleteTag", "pushTag", "createBranch", "deleteBranch", "renameBranch",
    "checkoutBranch", "checkoutCommit", "cherrypickCommit", "revertCommit", "resetToCommit",
    "mergeBranch", "mergeCommit", "inProgressAction",
  ].includes(command);
}
