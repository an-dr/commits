import type { RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";
import type { GitResult, NativeResult } from "@commits/ipc/native";
import type { HostPort } from "./host/host-port";
import { CommitsCoreWorkspacePort } from "./host/commits-core-workspace-port";
import { MitGraphBackend } from "./mit/graph-backend";
import { RepositoryManager } from "./read/repository-manager";
import { DEFAULT_PERSISTENT_STATE, PersistentExtensionState, type PersistentState } from "./read/persistent-state";

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
  private nextOsRequestId = 50_000;

  constructor(
    private readonly host: HostPort,
    private readonly pageHtml: string,
  ) {
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
    this.host.openPanel(PANEL, this.pageHtml);
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

    switch (value.command) {
      case "standaloneReady":
        this.bootstrap();
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
              maxCommits: typeof value.maxCommits === "number" ? value.maxCommits : 300,
              showRemoteBranches: value.showRemoteBranches !== false,
              hard: value.hard === true,
            },
            (response) => this.send(response),
          );
        }
        return;
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

  private bootstrap(): void {
    this.state = this.persistent.load();
    this.repositories.discover();
    if (this.state.lastActiveRepository !== null) {
      this.repositories.addExternal(this.state.lastActiveRepository);
      this.currentRepository = this.state.lastActiveRepository;
    }
    if (this.repositories.all().length === 0) {
      this.send({ command: "standaloneRepositoryRequired" });
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
      this.state = this.persistent.save({ ...this.state, lastActiveRepository: path });
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
