import type { GitFileChangeType } from "@an-dr/commits-core/backend/types";
import type { RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";
import type { GitResult, NativeResult } from "@commits/ipc/native";
import type { HostPort } from "./host/host-port";
import { CommitsCoreWorkspacePort } from "./host/commits-core-workspace-port";
import { MitGraphBackend } from "./mit/graph-backend";
import { RepositoryManager } from "./read/repository-manager";
import {
  DEFAULT_PERSISTENT_STATE,
  MAX_RECENT_REPOSITORIES,
  PersistentExtensionState,
  type PersistentState,
} from "./read/persistent-state";

const PANEL = "main";

type StandaloneRequest =
  | { readonly command: "standaloneReady" }
  | { readonly command: "standaloneChooseRepository" }
  | { readonly command: "standaloneOpenRepository"; readonly path: string };

type PendingOs =
  | { readonly kind: "chooseRepository" }
  | { readonly kind: "copy"; readonly type: string }
  | { readonly kind: "openExternalUrl" };

/** Bones owner of the unchanged MIT webview's host protocol. */
export class CommitsCore {
  private readonly repositories: RepositoryManager;
  private readonly persistent: PersistentExtensionState;
  private readonly graph: MitGraphBackend;
  private readonly pendingOs = new Map<number, PendingOs>();
  private state: PersistentState = DEFAULT_PERSISTENT_STATE;
  private currentRepository: string | null = null;
  private bootstrapped = false;
  private nextOsRequestId = 50_000;
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
    this.graph = new MitGraphBackend(host);
  }

  start(): void {
    this.host.subscribe("web/*");
    this.host.subscribe("os/result");
    this.host.subscribe("os/prompt");
    this.host.subscribe("git/completed");
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
        this.sendCurrentRepositories();
        return;
      case "standaloneChooseRepository":
        this.chooseRepository();
        return;
      case "standaloneOpenRepository":
        if (typeof value.path === "string") this.openRepository(value.path);
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
    if (pending.kind === "chooseRepository") {
      if (result.accepted && result.value) this.openRepository(result.value);
      else if (result.error) this.host.log("warn", result.error);
    } else if (pending.kind === "copy") {
      this.send({ command: "copyToClipboard", type: pending.type, success: result.accepted });
    } else {
      this.send({ command: "openExternalUrl", error: result.accepted ? null : result.error || "Unable to open URL" });
    }
  }

  receiveGitResult(result: GitResult): void {
    this.graph.receive(result);
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
    this.repositories.discover();
    if (this.state.lastActiveRepository !== null) {
      this.repositories.addExternal(this.state.lastActiveRepository);
      this.currentRepository = this.state.lastActiveRepository;
    }
    if (this.repositories.all().length === 0) {
      this.send({ command: "standaloneRepositoryRequired", recent: this.state.recentRepositories });
    } else {
      this.currentRepository ??= this.repositories.all()[0].path;
      this.sendRepos();
    }
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
