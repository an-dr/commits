import type { GitFileChangeType } from "@an-dr/commits-core/backend/types";
import type { GitRepoSet, RequestMessage, ResponseMessage, SubmoduleView } from "@an-dr/commits-core/types";
import { encodeFileRead, type DesktopResult, type GitResult, type NativeResult, type UpdaterResult, type WatchEvent } from "@commits/ipc/native";
import { HealthReader, type RepositoryHealth } from "./health/facts";
import { applyNavigation, type NavigationTarget } from "./navigation";
import type { LaunchRequest } from "@commits/ipc/native";
import { gravatarUrl } from "./gravatar";
import type { HostPort } from "./host/host-port";
import { CommitsCoreWorkspacePort } from "./host/commits-core-workspace-port";
import { MAX_LOADED_COMMITS, GitGraphBackend } from "./git/graph-backend";
import { buildToolRun, gitShowArgs } from "./git/external-tools";
import { WorkingTreeActions } from "./git/working-tree-actions";
import { RepositoryManager } from "./read/repository-manager";
import { parseSubmoduleEntries } from "./read/submodule-status";
import {
  DEFAULT_PERSISTENT_STATE,
  MAX_RECENT_REPOSITORIES,
  PersistentExtensionState,
  type PersistentState,
} from "./read/persistent-state";
import { DEFAULT_SETTINGS, parseSettings, validateSettings, type SettingsDocument } from "./read/settings";
import { RequestIds } from "./request-ids";
import { LaunchCoordinator } from "./launch-coordinator";
import { PANEL_NAME } from "./panel";
import { PendingRequests } from "./pending-requests";
import { Installation } from "./installation";


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
  | { readonly command: "standaloneInstall" }
  | { readonly command: "standaloneRegister" }
  | { readonly command: "standaloneUnregister" };

type PendingOs =
  | { readonly kind: "chooseRepository" }
  | { readonly kind: "findRepositories"; readonly folder: string }
  | { readonly kind: "copy"; readonly type: string }
  | { readonly kind: "openExternalUrl" }
  | { readonly kind: "revealCommitsRepoFolder" }
  | { readonly kind: "readFile"; readonly deliver: (content: string | null) => void }
  | { readonly kind: "fetchAvatar"; readonly email: string }
  | { readonly kind: "runTool" }
  /** Awaits the device code; `promptId` is the askpass prompt this sign-in answers. */
  | { readonly kind: "githubDeviceCode"; readonly promptId: string }
  /** Awaits the user approving the code in their browser. */
  | { readonly kind: "githubToken"; readonly promptId: string }
  | { readonly kind: "githubTokenStored" };

/** One diff whose two revisions are still being read out of Git. */
interface PendingToolDiff {
  readonly program: string;
  readonly args: readonly string[];
  /** Each side keeps its own name, so a rename reaches the tool as one. */
  readonly oldFilePath: string;
  readonly newFilePath: string;
  left?: Uint8Array;
  right?: Uint8Array;
  /** Set once a side has failed, so the second side's arrival stays quiet. */
  failed: boolean;
}

type PendingGit =
  /** The clone of the commits project's own repository; one at a time. */
  | { readonly kind: "clone" }
  | { readonly kind: "submoduleDiscovery"; readonly root: string }
  /** One side of an external-tool diff, read with `git show`. */
  | { readonly kind: "toolDiff"; readonly diff: PendingToolDiff; readonly side: "left" | "right" };

/** Bones owner of the shared webview's host protocol. */
export class CommitsCore {
  private readonly health: HealthReader;
  private latestHealth: RepositoryHealth | null = null;
  private readonly launches: LaunchCoordinator;
  private readonly navigationReads = new Map<number, (result: GitResult) => void>();
  private sessionLaunch: LaunchRequest = { kind: "none" };
  private readonly repositories: RepositoryManager;
  private readonly persistent: PersistentExtensionState;
  private readonly graph: GitGraphBackend;
  private readonly workingTreeActions: WorkingTreeActions;
  private readonly pendingOs = new PendingRequests<PendingOs>();
  private readonly pendingGit = new PendingRequests<PendingGit>();
  private readonly installation: Installation;
  private state: PersistentState = DEFAULT_PERSISTENT_STATE;
  private settings: SettingsDocument = DEFAULT_SETTINGS;
  private settingsError = "";
  /** Why the last folder offered -- on the command line or from the picker --
   *  held nothing to open, shown once on the chooser. */
  private chooserError = "";
  private currentRepository: string | null = null;
  /** Repository the watcher is pointed at, and the id correlating its events. */
  private watchedRepository: string | null = null;
  private watchRequestId = 0;
  private commitsRepoPath: string | null = null;
  private commitsRepoParentPath: string | null = null;
  private commitsRepoExists = false;
  private bootstrapped = false;
  private readonly osRequestIds = new RequestIds("os");
  private readonly gitRequestIds = new RequestIds("git");
  /** Nested submodules discovered per repository root, keyed by root path. */
  private readonly submodules = new Map<string, readonly SubmoduleView[]>();
  /** Root paths a submodule discovery has already been issued for, so a
   *  repeated `sendRepos` never re-queries the same root. */
  private readonly requestedSubmoduleRoots = new Set<string>();
  /** Roots with a discovery in flight, so the refresh the view asks for on
   *  every reread never stacks a second scan on top of the running one. */
  private readonly scanningSubmoduleRoots = new Set<string>();
  private readonly rescanSubmoduleRoots = new Set<string>();
  /** Counts panel file reads so only the newest one answers. */
  private fullDiffSequence = 0;
  /** Counts comparisons so only the newest selection answers. */
  private comparisonSequence = 0;

  constructor(private readonly host: HostPort) {
    this.launches = new LaunchCoordinator({
      applyLaunch: (request) => this.applyLaunch(request),
      navigate: (target) => this.navigate(target),
    });
    this.health = new HealthReader(host, (health) => {
      if (health.repository !== this.currentRepository) return;
      this.latestHealth = health;
      this.send({ command: "repoHealth", ...health });
    });
    const storage = {
      load: () => host.loadSavedState(),
      save: (value: Uint8Array<ArrayBufferLike>) => host.saveSavedState(value),
    };
    this.installation = new Installation(host, (message) => this.send(message));
    this.repositories = new RepositoryManager(new CommitsCoreWorkspacePort(host));
    this.persistent = new PersistentExtensionState(storage);
    this.graph = new GitGraphBackend(host, (repo, path, deliver) =>
      this.readWorkingTreeFile(repo, path, deliver),
    );
    // An action this app ran is the one change the watcher cannot be relied on
    // to report: WatcherModule discards its own start failure, so a watch that
    // never began would leave the cache serving history the app itself moved.
    this.workingTreeActions = new WorkingTreeActions(host, (repo) => this.graph.invalidate(repo));
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
    const requestId = this.osRequestIds.next();
    this.pendingOs.add(requestId, { kind: "readFile", deliver });
    this.host.requestRepoOs(requestId, "read-file", encodeFileRead(repo, path));
  }

  start(): void {
    this.host.subscribe("web/*");
    this.host.subscribe("os/result");
    this.host.subscribe("repo-os/result");
    this.host.subscribe("os/prompt");
    this.host.subscribe("git/completed");
    this.host.subscribe("upgrader/result");
    this.host.subscribe("desktop/result");
    this.host.subscribe("launch/request");
    this.host.subscribe("repo/full-refresh");
    this.host.subscribe("repo/lightweight-refresh");
    // Fetched here rather than at construction so the request reaches a running
    // host instead of the build-time snapshot taken while componentizing.
    this.host.openPanel(PANEL_NAME, this.host.loadPageSource());
    this.host.log("info", "commits graph panel requested");
  }

  stop(): void {
    this.host.closePanel(PANEL_NAME);
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
      case "standaloneFocus":
        this.refreshHealth();
        this.sendSources();
        return;
      case "standaloneSources":
        this.sendSources();
        return;
      case "standaloneHealthNavigate":
        this.navigateHealth();
        return;
      case "standaloneViewReady":
        this.refreshHealth();
        this.sendSources();
        this.sendSessionAppearance();
        this.sendRecentRepositories();
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
        if (typeof value.path === "string") this.openFolder(value.path);
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
        this.installation.startUpdate();
        return;
      case "standaloneInstall":
        this.installation.startInstall();
        return;
      case "standaloneRegister":
        this.installation.startRegistration("register");
        return;
      case "standaloneUnregister":
        this.installation.startRegistration("unregister");
        return;
      case "loadRepos":
        this.sendRepos();
        return;
      case "selectRepo":
        if (typeof value.repo === "string") this.selectRepository(value.repo);
        return;
      case "saveRepoState":
        return;
      case "credentialResponse":
        // The answer to an askpass question. The native side matches it to
        // the waiting Git process by id; an empty value is a refusal, which
        // fails the command rather than leaving it waiting.
        if (typeof value.id === "string" && typeof value.value === "string") {
          this.host.respondPrompt(value.id, value.value);
        }
        return;
      case "loadBranches":
        // Answered even with nothing open. The view holds one in-flight
        // branch load at a time and drops later requests until this one
        // replies, so staying silent here wedges it on "Loading ..." for the
        // rest of the session -- including after a repository is finally
        // chosen. `isRepo: false` is the view's own word for "that is not a
        // repository", and it responds by re-asking for the repository list.
        if (this.currentRepository === null) {
          this.send({
            command: "loadBranches",
            branches: [],
            head: null,
            hard: value.hard === true,
            isRepo: false,
          });
          return;
        }
        this.graph.loadBranches(
          {
            command: "loadBranches",
            repo: this.currentRepository,
            showRemoteBranches: value.showRemoteBranches !== false,
            hard: value.hard === true,
          },
          (response) => this.send(response),
        );
        return;
      case "loadCommits":
        if (typeof value.repo === "string") this.selectRepository(value.repo, false);
        // Same one-in-flight rule as loadBranches above, and the same
        // consequence for staying silent.
        if (this.currentRepository === null) {
          this.send({
            command: "loadCommits",
            commits: [],
            head: null,
            moreCommitsAvailable: false,
            hard: value.hard === true,
          });
          return;
        }
        this.launches.loadStarted();
        const loadingRepository = this.currentRepository;
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
          (response) => {
            this.send(response);
            this.launches.loadFinished(loadingRepository, this.currentRepository);
          },
        );
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
        this.sendInProgress();
        return;
      case "submoduleStatus":
        this.reportSubmodules();
        return;
      case "submoduleUpdate":
        this.updateSubmodules(typeof value.repo === "string" ? value.repo : undefined);
        return;
      case "remoteOperation": {
        const operation = value.operation;
        if (operation !== "fetch" && operation !== "pull" && operation !== "push") return;
        this.workingTreeActions.remoteOperation(this.currentRepository ?? "", operation, (status) => {
          this.send({ command: "remoteOperation", operation, status });
        });
        return;
      }
      case "pullBranch":
        this.workingTreeActions.pullBranch(
          this.currentRepository ?? "",
          asString(value.remote),
          asString(value.branchName),
          (status) => this.send({ command: "pullBranch", status }),
        );
        return;
      case "deleteRemoteBranch":
        this.workingTreeActions.deleteRemoteBranch(
          this.currentRepository ?? "",
          asString(value.remote),
          asString(value.branchName),
          (status) => this.send({ command: "deleteRemoteBranch", status }),
        );
        return;
      case "checkoutBranch":
        this.workingTreeActions.checkoutBranch(
          this.currentRepository ?? "",
          asString(value.branchName),
          typeof value.remoteBranch === "string" ? value.remoteBranch : null,
          (status) => this.send({ command: "checkoutBranch", status }),
        );
        return;
      case "renameBranch":
        this.workingTreeActions.renameBranch(
          this.currentRepository ?? "",
          asString(value.oldName),
          asString(value.newName),
          (status) => this.send({ command: "renameBranch", status }),
        );
        return;
      case "deleteBranch":
        this.workingTreeActions.deleteBranch(
          this.currentRepository ?? "",
          asString(value.branchName),
          value.forceDelete === true,
          (status) => this.send({ command: "deleteBranch", status }),
        );
        return;
      case "mergeBranch":
        this.workingTreeActions.mergeBranch(
          this.currentRepository ?? "",
          asString(value.branchName),
          value.createNewCommit === true,
          (status) => this.send({ command: "mergeBranch", status }),
        );
        return;
      case "createBranch":
        this.workingTreeActions.createBranch(
          this.currentRepository ?? "",
          asString(value.branchName),
          asString(value.commitHash),
          value.checkout === true,
          value.force === true,
          (status) => this.send({ command: "createBranch", status }),
        );
        return;
      case "runTool":
        this.runTool(
          asString(value.program),
          Array.isArray(value.args) ? value.args.map((argument) => asString(argument)) : [],
          isRecord(value.diff)
            ? {
                oldFilePath: asString(value.diff.oldFilePath),
                newFilePath: asString(value.diff.newFilePath),
                fromHash: asString(value.diff.fromHash),
                toHash: asString(value.diff.toHash),
                type: asString(value.diff.type),
              }
            : undefined,
        );
        return;
      case "rebase":
        this.workingTreeActions.rebase(
          this.currentRepository ?? "",
          asString(value.commitHash),
          value.ignoreDate === true,
          (status) => this.send({ command: "rebase", status }),
        );
        return;
      case "inProgressAction":
        this.workingTreeActions.inProgressAction(
          this.currentRepository ?? "",
          asInProgressType(value.operationType),
          value.action === "abort" ? "abort" : "continue",
          (status) => this.send({ command: "inProgressAction", status }),
        );
        return;
      case "checkoutCommit":
        this.workingTreeActions.checkoutCommit(
          this.currentRepository ?? "",
          asString(value.commitHash),
          (status) => this.send({ command: "checkoutCommit", status }),
        );
        return;
      case "cherrypickCommit":
        this.workingTreeActions.cherrypickCommit(
          this.currentRepository ?? "",
          asString(value.commitHash),
          asNumber(value.parentIndex),
          (status) => this.send({ command: "cherrypickCommit", status }),
        );
        return;
      case "revertCommit":
        this.workingTreeActions.revertCommit(
          this.currentRepository ?? "",
          asString(value.commitHash),
          asNumber(value.parentIndex),
          (status) => this.send({ command: "revertCommit", status }),
        );
        return;
      case "resetToCommit":
        this.workingTreeActions.resetToCommit(
          this.currentRepository ?? "",
          asString(value.commitHash),
          asResetMode(value.resetMode),
          (status) => this.send({ command: "resetToCommit", status }),
        );
        return;
      case "mergeCommit":
        this.workingTreeActions.mergeCommit(
          this.currentRepository ?? "",
          asString(value.commitHash),
          value.createNewCommit === true,
          (status) => this.send({ command: "mergeCommit", status }),
        );
        return;
      case "addTag":
        this.workingTreeActions.addTag(
          this.currentRepository ?? "",
          asString(value.tagName),
          asString(value.commitHash),
          value.lightweight === true,
          asString(value.message),
          value.force === true,
          (status) => this.send({ command: "addTag", status }),
        );
        return;
      case "deleteTag":
        this.workingTreeActions.deleteTag(
          this.currentRepository ?? "",
          asString(value.tagName),
          (status) => this.send({ command: "deleteTag", status }),
        );
        return;
      case "pushTag":
        this.workingTreeActions.pushTag(
          this.currentRepository ?? "",
          asString(value.tagName),
          asString(value.remote),
          (status) => this.send({ command: "pushTag", status }),
        );
        return;
      case "pushBranch":
        this.workingTreeActions.pushBranch(
          this.currentRepository ?? "",
          asString(value.remote),
          asString(value.branchName),
          (status) => this.send({ command: "pushBranch", status }),
        );
        return;
      case "addRemote":
        this.workingTreeActions.addRemote(
          this.currentRepository ?? "",
          asString(value.name),
          asString(value.url),
          (status) => this.send({ command: "addRemote", status }),
        );
        return;
      case "renameRemote":
        this.workingTreeActions.renameRemote(
          this.currentRepository ?? "",
          asString(value.oldName),
          asString(value.newName),
          (status) => this.send({ command: "renameRemote", status }),
        );
        return;
      case "removeRemote":
        this.workingTreeActions.removeRemote(
          this.currentRepository ?? "",
          asString(value.name),
          (status) => this.send({ command: "removeRemote", status }),
        );
        return;
      case "setRemoteUrl":
        this.workingTreeActions.setRemoteUrl(
          this.currentRepository ?? "",
          asString(value.name),
          asString(value.url),
          (status) => this.send({ command: "setRemoteUrl", status }),
        );
        return;
      case "setDefaultRemote":
        this.workingTreeActions.setDefaultRemote(
          this.currentRepository ?? "",
          asString(value.name),
          (status) => this.send({ command: "setDefaultRemote", status }),
        );
        return;
      case "copyToClipboard":
        if (typeof value.data === "string" && typeof value.type === "string") {
          const requestId = this.osRequestIds.next();
          this.pendingOs.add(requestId, { kind: "copy", type: value.type });
          this.host.requestOs(requestId, "clipboard-write", value.data);
        }
        return;
      case "openExternalUrl":
        if (typeof value.url === "string") {
          const requestId = this.osRequestIds.next();
          this.pendingOs.add(requestId, { kind: "openExternalUrl" });
          this.host.requestOs(requestId, "open-url", value.url);
        }
        return;
      case "getRelativeTimeDiff":
        this.send({ command: "getRelativeTimeDiff", value: "" });
        return;
      case "fetchAvatar":
        if (typeof value.email === "string" && value.email) {
          const requestId = this.osRequestIds.next();
          this.pendingOs.add(requestId, { kind: "fetchAvatar", email: value.email });
          this.host.requestOs(requestId, "fetch-url", gravatarUrl(value.email));
        }
        return;
      case "githubSignIn": {
        const promptId = asString(value.id);
        const requestId = this.osRequestIds.next();
        this.pendingOs.add(requestId, { kind: "githubDeviceCode", promptId });
        this.host.requestRepoOs(requestId, "start-github-device-code");
        return;
      }
      default:
        this.host.log("debug", `ignored unsupported view command: ${value.command}`);
    }
  }

  receiveOsResult(result: NativeResult): void {
    const pending = this.pendingOs.take(result.requestId);
    if (pending === undefined) return;
    if (pending.kind === "readFile") {
      if (result.error) this.host.log("warn", result.error);
      pending.deliver(result.accepted ? result.value : null);
    } else if (pending.kind === "chooseRepository") {
      if (result.accepted && result.value) this.openFolder(result.value);
      else if (result.error) this.host.log("warn", result.error);
    } else if (pending.kind === "findRepositories") {
      this.finishFindRepositories(pending.folder, result);
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
    } else if (pending.kind === "githubDeviceCode") {
      if (!result.accepted || !result.value) {
        this.send({
          command: "githubSignIn", promptId: pending.promptId, signInStatus: "error",
          message: result.error || "Unable to start GitHub sign-in.",
        });
        return;
      }
      const [userCode, verificationUri, deviceCode, interval, expiresIn] = result.value.split("\n");
      this.send({ command: "githubSignIn", promptId: pending.promptId, signInStatus: "code", userCode, verificationUri });
      const pollId = this.osRequestIds.next();
      this.pendingOs.add(pollId, { kind: "githubToken", promptId: pending.promptId });
      this.host.requestRepoOs(pollId, "poll-github-token", `${deviceCode}\n${interval}\n${expiresIn}`);
    } else if (pending.kind === "githubToken") {
      if (!result.accepted || !result.value) {
        this.send({
          command: "githubSignIn", promptId: pending.promptId, signInStatus: "error",
          message: result.error || "GitHub sign-in was not completed.",
        });
        return;
      }
      const storeId = this.osRequestIds.next();
      this.pendingOs.add(storeId, { kind: "githubTokenStored" });
      this.host.requestRepoOs(storeId, "store-github-token", result.value);
      // The username-phase askpass process is still waiting on this same
      // prompt; the password phase moments later reads the keychain itself.
      this.host.respondPrompt(pending.promptId, "x-access-token");
      this.send({ command: "githubSignIn", promptId: pending.promptId, signInStatus: "done" });
    } else if (pending.kind === "githubTokenStored") {
      if (!result.accepted && result.error) this.host.log("warn", result.error);
    } else {
      this.send({ command: "openExternalUrl", error: result.accepted ? null : result.error || "Unable to open URL" });
    }
  }

  receiveGitResult(result: GitResult): void {
    const pending = this.pendingGit.take(result.requestId);
    if (pending?.kind === "clone") { this.finishCloneCommitsRepo(result); return; }
    if (pending?.kind === "submoduleDiscovery") { this.finishSubmoduleDiscovery(pending.root, result); return; }
    if (pending?.kind === "toolDiff") { this.finishToolDiffSide(pending, result); return; }
    if (this.health.receive(result)) return;
    const navigationRead = this.navigationReads.get(result.requestId);
    if (navigationRead) { this.navigationReads.delete(result.requestId); navigationRead(result); return; }
    this.graph.receive(result);
    this.workingTreeActions.receive(result);
  }

  receiveDesktopResult(result: DesktopResult): void {
    this.installation.receiveDesktopResult(result);
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
    if (this.pendingGit.has("clone")) {
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
    const requestId = this.gitRequestIds.next();
    this.pendingGit.add(requestId, { kind: "clone" });
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
    this.openFolder(this.commitsRepoPath);
  }

  /**
   * Runs a configured tool, reading both revisions first when it is a diff.
   *
   * A diff tool takes two paths on disk, and neither revision is one: they are
   * objects in the repository. So each side is read with `git show` here and
   * travels with the run, and the host turns them into the files the tool
   * actually opens.
   */
  private runTool(
    program: string,
    args: readonly string[],
    diff?: {
      oldFilePath: string;
      newFilePath: string;
      fromHash: string;
      toHash: string;
      type: string;
    },
  ): void {
    if (program === "") {
      this.send({ command: "runTool", status: "No tool is configured." });
      return;
    }
    if (diff === undefined) {
      this.startTool(buildToolRun(program, args));
      return;
    }
    const repo = this.currentRepository ?? "";
    if (repo === "") {
      this.send({ command: "runTool", status: "No repository is open." });
      return;
    }
    const pending: PendingToolDiff = {
      program,
      args,
      oldFilePath: diff.oldFilePath,
      newFilePath: diff.newFilePath,
      failed: false,
    };
    // An added file has nothing on the left and a deleted one nothing on the
    // right; the tool still wants two files, so that side is an empty one.
    if (diff.type === "A") pending.left = new Uint8Array();
    if (diff.type === "D") pending.right = new Uint8Array();
    // The base is resolved the same way the built-in panel resolves it, so the
    // two never disagree about which revisions a commit is compared against.
    this.graph.resolveDiffBase(repo, diff.fromHash, diff.toHash, (oldRevision) => {
      const sides = [
        ["left", oldRevision, diff.oldFilePath],
        ["right", diff.toHash, diff.newFilePath],
      ] as const;
      for (const [side, hash, path] of sides) {
        if (pending[side] !== undefined) continue;
        const requestId = this.gitRequestIds.next();
        this.pendingGit.add(requestId, { kind: "toolDiff", diff: pending, side });
        this.host.runGit({ requestId, cwd: repo, args: gitShowArgs(hash, path), timeoutMs: 30_000 });
      }
      this.startToolIfDiffComplete(pending);
    });
  }

  /** Takes one side's `git show` result, running the tool once both are in. */
  private finishToolDiffSide(
    entry: { diff: PendingToolDiff; side: "left" | "right" },
    result: GitResult,
  ): void {
    const { diff, side } = entry;
    if (result.status !== "completed" || result.exitCode !== 0) {
      // The other side is still coming, and one message is enough: a file that
      // does not exist at one of the two revisions fails only on that side.
      if (!diff.failed) {
        diff.failed = true;
        this.send({ command: "runTool", status: summarizeGitFailure(result) });
      }
      return;
    }
    diff[side] = result.stdout;
    this.startToolIfDiffComplete(diff);
  }

  /** Runs the tool once both sides are in hand, and not before. */
  private startToolIfDiffComplete(diff: PendingToolDiff): void {
    if (diff.failed || diff.left === undefined || diff.right === undefined) {
      return;
    }
    this.startTool(
      buildToolRun(diff.program, diff.args, {
        left: { path: diff.oldFilePath, content: diff.left },
        right: { path: diff.newFilePath, content: diff.right },
      }),
    );
  }

  /** Hands one framed run to the OS module. */
  private startTool(request: string): void {
    const requestId = this.osRequestIds.next();
    this.pendingOs.add(requestId, { kind: "runTool" });
    this.host.requestRepoOs(requestId, "run-tool", request);
  }

  /** Reveals ~/.commits/repo in the OS's native file manager. */
  private revealCommitsRepoFolder(): void {
    if (!this.commitsRepoExists || this.commitsRepoPath === null) return;
    const requestId = this.osRequestIds.next();
    this.pendingOs.add(requestId, { kind: "revealCommitsRepoFolder" });
    this.host.requestOs(requestId, "reveal-directory", this.commitsRepoPath);
  }

  /** Re-announces repository availability without redoing discovery. */
  private sendCurrentRepositories(): void {
    if (this.repositories.all().length === 0) {
      this.send({
        command: "standaloneRepositoryRequired",
        recent: this.state.recentRepositories,
        lastActive: this.state.lastActiveRepository ?? "",
        error: this.chooserError,
      });
      // Said once. Reopening the chooser later in the same session is not
      // still about the argument this process started with.
      this.chooserError = "";
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
    // The command line decides what opens; nothing else does. A remembered
    // repository is offered on the chooser rather than opened behind the
    // user's back, so starting the app never silently reattaches to whatever
    // was last in use -- which is the whole point of asking for a path.
    const launch = this.launches.start(this.host.launchRequest());
    this.sessionLaunch = launch;
    if (launch.kind === "repository") {
      // Through addExternal and its normalised path, not by assignment: a
      // repository opened from the command line joins the recent list like
      // any other, and `C:\repo` from a shell must land on the same entry as
      // the `C:/repo` everything else here uses -- otherwise one repository
      // occupies two rows that disagree about which is current.
      this.addRepositories(launch.paths);
    } else if (launch.kind === "rejected") {
      this.chooserError = launch.reason;
      this.host.log("warn", `ignoring the repository given on the command line: ${launch.reason}`);
    }
    // A host that hands over repositories -- VS Code's workspace folders --
    // still opens one, because there the user already chose them by opening
    // the workspace. Standalone supplies none, which is what leaves the
    // chooser in front of them.
    if (this.repositories.all().length > 0) this.currentRepository ??= this.repositories.all()[0].path;
    // The startup request's navigation waits for the opened repository's first load.
    this.launches.launchApplied(launch, { repository: this.currentRepository, repositoryChanged: true });
    this.installation.start();
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
    const requestId = this.osRequestIds.next();
    this.pendingOs.add(requestId, { kind: "chooseRepository" });
    this.host.requestOs(requestId, "pick-folder");
  }

  /**
   * Opens a folder the user pointed at, whatever it turns out to hold: the
   * repository itself, the repositories inside it, or both. Only the host can
   * look, so this asks it and finishes in `finishFindRepositories`.
   */
  private openFolder(path: string): void {
    const requestId = this.osRequestIds.next();
    this.pendingOs.add(requestId, { kind: "findRepositories", folder: path });
    this.host.requestRepoOs(requestId, "find-repositories", path);
  }

  private finishFindRepositories(folder: string, result: NativeResult): void {
    const paths = result.accepted ? result.value.split("\n").filter((path) => path !== "") : [];
    if (paths.length === 0) {
      this.chooserError = result.error || `there is no git repository in ${folder}`;
      this.host.log("warn", `nothing to open in ${folder}`);
      this.sendCurrentRepositories();
      return;
    }
    this.addRepositories(paths);
    this.sendRepos();
  }

  /**
   * Registers every repository found under one folder and opens the first.
   *
   * Through addExternal and its normalised paths: `C:\repo` from a shell must
   * land on the same entry as the `C:/repo` everything else here uses --
   * otherwise one repository occupies two rows that disagree about which is
   * current.
   */
  private addRepositories(paths: readonly string[]): void {
    let first: string | null = null;
    for (const path of paths) {
      const repository = this.repositories.addExternal(path);
      if (repository !== null && first === null) first = repository.path;
    }
    if (first !== null) this.selectRepository(first);
  }

  /**
   * Points the file watcher at the repository now on screen. Only one is
   * watched at a time: watching every repository ever opened would keep OS
   * handles on trees nobody is looking at.
   */
  private watchCurrentRepository(path: string): void {
    if (this.watchedRepository === path) {
      return;
    }
    if (this.watchedRepository !== null) {
      this.host.watchRepository(this.watchRequestId, "stop", this.watchedRepository);
    }
    this.watchRequestId += 1;
    this.watchedRepository = path;
    this.host.watchRepository(this.watchRequestId, "start", path);
  }

  /**
   * A change reached the repository from outside the app. The event is already
   * one per burst -- the native watcher settles the storm a single `git commit`
   * produces -- so this only decides how much of the read state it invalidates.
   *
   * A metadata change moved the refs, so history is reread. A worktree change
   * cannot alter history, so only the working tree panel is: saving a file must
   * not cost a `git log` of the whole repository.
   */
  receiveWatchEvent(event: WatchEvent): void {
    if (event.requestId !== this.watchRequestId || event.repository !== this.watchedRepository) {
      return;
    }
    if (event.kind === "full") {
      // The refs moved outside the app, so remembered history is out of date.
      // A worktree change is left alone: it cannot alter what is committed.
      this.graph.invalidate(event.repository);
    }
    this.refreshHealth();
    this.send({ command: "refresh", scope: event.kind === "full" ? "all" : "worktree" });
  }

  private selectRepository(path: string, persist = true): void {
    const changed = this.currentRepository !== path;
    if (changed) this.launches.repositoryChanged();
    this.currentRepository = path;
    if (changed) { this.latestHealth = null; this.refreshHealth(); }
    this.watchCurrentRepository(path);
    if (persist) {
      this.state = this.persistent.save({
        ...this.state,
        lastActiveRepository: path,
        recentRepositories: withMostRecent(this.state.recentRepositories, path),
      });
      this.sendRecentRepositories();
    }
  }

  /**
   * Publishes the recent list on its own message.
   *
   * The chooser's own message only fires when nothing is open, and the menu
   * needs this list precisely when something is -- so it cannot ride on that
   * one, and putting it on `loadRepos` would tie a menu concern to the graph's
   * payload.
   */
  private sendRecentRepositories(): void {
    this.send({
      command: "standaloneRecentRepositories",
      recent: this.state.recentRepositories,
      lastActive: this.state.lastActiveRepository ?? "",
    });
  }

  /**
   * Publishes the repository list with the nesting each row should show.
   *
   * Depth is stated rather than left to the view's path-prefix rule: a
   * repository that merely sits inside another one -- a clone someone put
   * there, not a submodule of it -- is its own project and belongs at the
   * left margin. Only submodules, which the parent really does own, indent.
   *
   * Submodules are discovered for the open repository alone, never for the
   * whole list. `git submodule status --recursive` costs seconds on a cold
   * disk and the git runner allows four at a time, so asking it of every row
   * would leave a folder of forty clones queueing scans for the best part of
   * a minute -- ahead of the commit query the view is waiting on. An
   * undiscovered repository simply sits at the left margin until it is
   * opened, which is where a repository belongs anyway.
   */
  private sendRepos(): void {
    const repos: GitRepoSet = {};
    if (this.currentRepository !== null) {
      this.discoverSubmodulesIfNeeded(this.rootFor(this.currentRepository));
    }
    for (const repository of this.repositories.all()) {
      repos[repository.path] = { columnWidths: null, depth: 0 };
    }
    for (const repository of this.repositories.all()) {
      const submodules = this.submodules.get(repository.path) ?? [];
      for (const submodule of submodules) {
        const submodulePath = `${repository.path}/${submodule.path}`;
        // A submodule of a submodule is one level deeper again, which its own
        // path already says: `--recursive` reports both, and the nested one
        // is a path extension of the outer one.
        const nesting = submodules.filter(
          (other) => other.path !== submodule.path && submodule.path.startsWith(`${other.path}/`),
        ).length;
        repos[submodulePath] = {
          columnWidths: null,
          depth: nesting + 1,
          submodule: submodule.state,
        };
      }
    }
    this.send({ command: "loadRepos", repos, lastActiveRepo: this.currentRepository });
  }

  /**
   * Recurses through a repository's submodules once per root path, so the
   * repo selector can nest them the way `git submodule status --recursive`
   * reports them -- including submodules of submodules.
   */
  /**
   * The repository row that owns a path: the path itself when it is one of the
   * open repositories, and otherwise the root whose submodule it is.
   *
   * A submodule row in the selector is not a repository the app opened -- it
   * is a path inside one -- so everything that concerns the tree as a whole,
   * the recursive update and the scan that reports it, runs in the root. An
   * uninitialized submodule makes this more than tidiness: its folder holds
   * no repository to run anything in, and may not exist at all.
   */
  private rootFor(path: string): string {
    if (this.repositories.all().some((repository) => repository.path === path)) return path;
    for (const repository of this.repositories.all()) {
      if (!path.startsWith(`${repository.path}/`)) continue;
      const relative = path.slice(repository.path.length + 1);
      const submodules = this.submodules.get(repository.path) ?? [];
      if (submodules.some((submodule) => submodule.path === relative)) return repository.path;
    }
    return path;
  }

  private discoverSubmodulesIfNeeded(rootPath: string): void {
    if (this.requestedSubmoduleRoots.has(rootPath)) return;
    this.scanSubmodules(rootPath);
  }

  /**
   * Rereads one repository's submodules, whether or not it has been scanned
   * before.
   *
   * The view asks for this on every refresh, and a refresh arrives whenever
   * the watcher sees the repository move -- which is exactly when a submodule
   * pointer changes under a branch switch, or a `git submodule add` lands a
   * new one. A scan already in flight is left to finish rather than joined by
   * a second: they would read the same tree and answer with the same list.
   */
  private scanSubmodules(rootPath: string): void {
    if (this.scanningSubmoduleRoots.has(rootPath)) return;
    this.requestedSubmoduleRoots.add(rootPath);
    this.scanningSubmoduleRoots.add(rootPath);
    const requestId = this.gitRequestIds.next();
    this.pendingGit.add(requestId, { kind: "submoduleDiscovery", root: rootPath });
    this.host.runGit({
      requestId,
      cwd: rootPath,
      args: ["submodule", "status", "--recursive"],
      timeoutMs: 15_000,
    });
  }

  /** Reacts to a submodule discovery's GitResult: records what was found (if
   *  anything) and, only when that changes what the selector should show,
   *  re-sends the repo list. A plain repository with no submodules stays
   *  silent there, but still answers the view's status request, because
   *  "this repository has none" is the answer that takes the banner down. */
  private finishSubmoduleDiscovery(rootPath: string, result: GitResult): void {
    this.scanningSubmoduleRoots.delete(rootPath);
    if (this.rescanSubmoduleRoots.delete(rootPath)) {
      this.scanSubmodules(rootPath);
      return;
    }
    const previous = this.submodules.get(rootPath) ?? [];
    const found =
      result.status === "completed" && result.exitCode === 0
        ? parseSubmoduleEntries(new TextDecoder().decode(result.stdout))
        : [];
    this.submodules.set(rootPath, found);
    // Only when the rows or their markers actually differ: this scan reruns on
    // every refresh, and a repo list resent each time would re-render the
    // selector -- under an open dropdown -- to say nothing new.
    if (describe(found) !== describe(previous)) this.sendRepos();
    if (this.currentRepository !== null && this.rootFor(this.currentRepository) === rootPath) {
      this.sendSubmoduleStatus(rootPath);
    }
  }

  /** Publishes the open repository's submodules, which is what the banner and
   *  the selector's markers are drawn from. */
  private sendSubmoduleStatus(rootPath: string): void {
    this.send({
      command: "submoduleStatus",
      repo: rootPath,
      submodules: this.submodules.get(rootPath) ?? [],
    });
  }

  /**
   * Answers the view's status request from what is already known and starts a
   * fresh scan behind it.
   *
   * Answering first is what keeps the banner steady across a refresh: waiting
   * for the scan would blank it and paint it again a moment later, on a
   * repository nothing about had changed. A repository never scanned answers
   * empty, which is right for the case that matters -- the user has just
   * switched to it, and the banner still shows the one they left.
   */
  private reportSubmodules(): void {
    if (this.currentRepository === null) {
      this.send({ command: "submoduleStatus", repo: "", submodules: [] });
      return;
    }
    const rootPath = this.rootFor(this.currentRepository);
    this.sendSubmoduleStatus(rootPath);
    this.scanSubmodules(rootPath);
  }

  /**
   * Initializes and checks out every submodule of the open repository, then
   * rereads them so the banner and the selector reflect what the update did
   * rather than what was true before it.
   */
  private updateSubmodules(repository = this.currentRepository): void {
    const rootPath = repository === null ? null : this.rootFor(repository);
    this.workingTreeActions.updateSubmodules(rootPath ?? "", (status) => {
      if (rootPath !== null) {
        // An update that failed part-way still cloned some of the tree, so the
        // recorded state is stale either way.
        this.requestedSubmoduleRoots.delete(rootPath);
        if (this.scanningSubmoduleRoots.has(rootPath)) {
          this.rescanSubmoduleRoots.add(rootPath);
        } else {
          this.scanSubmodules(rootPath);
        }
      }
      this.send({ command: "submoduleUpdate", status });
    });
  }

  private send(message: ResponseMessage | Record<string, unknown>): void {
    this.host.sendPageMessage(PANEL_NAME, message);
    if ("status" in message && typeof message.command === "string" && !message.command.startsWith("standalone")) this.refreshHealth();
  }

  receiveUpgradeResult(result: UpdaterResult & { previous?: string | null }): void {
    this.installation.receiveUpgradeResult(result);
  }

  /** A handoff from a later `commits` run; see {@link LaunchCoordinator}. */
  receiveLaunchRequest(request: LaunchRequest): void {
    this.launches.receive(request);
  }

  /** Opens a launch's repositories and applies its appearance; the coordinator decides on its navigation. */
  private applyLaunch(request: LaunchRequest): void {
    if (request.theme || request.themeFileName) {
      this.sessionLaunch = { ...this.sessionLaunch, ...(request.theme ? { theme: request.theme } : {}),
        ...(request.themeFileName ? { themeFileName: request.themeFileName, themeFile: request.themeFile, themeFileError: request.themeFileError } : {}) };
      this.sendSessionAppearance();
    }
    const previous = this.currentRepository;
    if (request.kind === "repository") {
      this.addRepositories(request.paths);
      this.sendRepos();
    } else if (request.kind === "rejected") {
      this.notice(request.reason);
    }
    this.launches.launchApplied(request, {
      repository: this.currentRepository,
      repositoryChanged: previous !== this.currentRepository,
    });
  }

  private sendSessionAppearance(): void { this.send({ command: "standaloneSessionAppearance", ...this.sessionLaunch }); }
  private sendSources(): void { this.send({ command: "standaloneSources", sources: this.host.repositorySources() }); }
  private notice(message: string): void { this.send({ command: "standaloneNotice", message }); }
  private refreshHealth(): void { if (this.currentRepository) this.health.refresh(this.currentRepository); }

  private sendInProgress(): void {
    const health = this.latestHealth;
    const operation = health?.facts.operation ?? (this.currentRepository ? this.host.repositoryState(this.currentRepository).operation : null);
    this.send({ command: "repoInProgress", state: operation && operation !== "bisect" ? {
      type: operation, subject: null, rebaseProgress: null, rebaseContext: null,
      workingTreeStatus: health?.workingTree ?? null,
    } : null });
  }

  private navigateHealth(): void {
    const health = this.latestHealth;
    if (!health) return;
    switch (health.verdict.id) {
      case "dirty": this.navigateInCurrent({ show: "changes" }); break;
      case "conflicted": case "in-progress": this.navigateInCurrent({ show: "conflicts" }); break;
      case "detached": if (health.head) this.navigateInCurrent({ commit: health.head }); break;
      case "diverged": case "behind": case "ahead": case "unpublished": if (health.branch) this.navigateInCurrent({ branch: health.branch }); break;
    }
  }

  private navigateInCurrent(target: NavigationTarget): void {
    if (this.currentRepository) this.launches.requestNavigation(target, this.currentRepository);
  }

  /** Selects a target in the open repository; only the coordinator calls this, once the graph is settled. */
  private navigate(target: NavigationTarget): void {
    applyNavigation(target, {
      selectWorkingTree: () => { this.sendInProgress(); this.send({ command: "standaloneNavigate", hash: "*" }); },
      selectGraph: () => this.send({ command: "standaloneNavigate", hash: null }),
      selectRevision: (revision, branch) => this.selectNavigationRevision(revision, branch),
    });
  }

  private selectNavigationRevision(revision: string, branch: boolean): void {
    const repository = this.currentRepository;
    if (!repository) return;
    const generation = this.launches.beginNavigationStep();
    const requestId = this.gitRequestIds.next();
    this.navigationReads.set(requestId, (result) => {
      if (!this.launches.isCurrent(generation) || repository !== this.currentRepository) return;
      if (result.exitCode !== 0) { this.notice(`Could not select ${branch ? "branch" : "commit"} ${revision}: target does not exist.`); return; }
      const hash = new TextDecoder().decode(result.stdout).trim();
      // The graph never loads more than MAX_LOADED_COMMITS, so a larger setting
      // would only make the notice name a limit that was not applied.
      const maxCommits = Math.min(this.settings.app.navigationMaxCommits, MAX_LOADED_COMMITS);
      this.graph.loadCommits({ command: "loadCommits", repo: repository, branchName: "", branches: [], maxCommits, showRemoteBranches: true, hard: false }, (response) => {
        if (!this.launches.isCurrent(generation) || repository !== this.currentRepository) return;
        this.send(response);
        if (response.command === "loadCommits" && response.commits.some((commit) => commit.hash === hash)) this.send({ command: "standaloneNavigate", hash });
        else this.notice(`Could not select ${revision}: outside the loaded history (limit ${maxCommits}).`);
      });
    });
    this.host.runGit({ requestId, cwd: repository, args: ["rev-parse", "--verify", "--end-of-options", `${branch ? `refs/heads/${revision}` : revision}^{commit}`] });
  }
}

/** One comparable string for a submodule list, paths and states together. */
function describe(submodules: readonly SubmoduleView[]): string {
  return submodules.map((submodule) => `${submodule.path}:${submodule.state}`).join("\n");
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
/**
 * Which operation is part-way through. Merge is the safe reading of anything
 * unrecognised: every operation accepts `--abort`, and continuing a merge
 * cannot rewrite history the way continuing a rebase can.
 */
function asInProgressType(value: unknown): "rebase" | "merge" | "cherry-pick" | "revert" {
  return value === "rebase" || value === "cherry-pick" || value === "revert" ? value : "merge";
}

/** A parent index the page sent; anything unusable means "no mainline given". */
function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The reset mode, defaulting to the one that cannot lose work. A malformed
 * value must never be read as "hard".
 */
function asResetMode(value: unknown): "soft" | "mixed" | "hard" {
  return value === "soft" || value === "hard" ? value : "mixed";
}

function asFileChangeType(value: unknown): GitFileChangeType {
  const letter = asString(value).toUpperCase();
  return letter === "A" || letter === "D" || letter === "R" ? letter : "M";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

