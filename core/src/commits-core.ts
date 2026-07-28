import type { HostPort } from "./host/host-port";
import { isRequestMessage, type ResponseMessage } from "./protocol";
import type { GitResult, NativeResult } from "../../proto/ts/native";
import { ReadBackend, type RepositorySnapshot } from "./read/read-backend";
import { RepositoryManager } from "./read/repository-manager";
import { FileBackedSettings } from "./read/settings";
import { DEFAULT_PERSISTENT_STATE, PersistentExtensionState, type PersistentState } from "./read/persistent-state";

const PANEL = "main";

/** Host-independent owner of page lifecycle and request dispatch. */
export class CommitsCore {
  private readonly repositories: RepositoryManager;
  private readonly settings: FileBackedSettings;
  private readonly persistent: PersistentExtensionState;
  private readonly backend: ReadBackend;
  private state: PersistentState;

  constructor(
    private readonly host: HostPort,
    private readonly pageHtml: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    const storage = { load: () => host.loadSavedState(), save: (value: Uint8Array<ArrayBufferLike>) => host.saveSavedState(value) };
    this.repositories = new RepositoryManager(host);
    this.settings = new FileBackedSettings(storage);
    this.persistent = new PersistentExtensionState(storage);
    // `send("persistence")` is not available while Wizer initializes the
    // component. Restore only after the real page has connected.
    this.state = DEFAULT_PERSISTENT_STATE;
    this.backend = new ReadBackend({
      runGit: (request) => host.runGit(request),
      deliver: (snapshot) => this.sendSnapshot(snapshot),
    });
  }

  start(): void {
    this.host.subscribe("web/*");
    this.host.subscribe("os/result");
    this.host.subscribe("git/completed");
    this.host.openPanel(PANEL, this.pageHtml);
    this.host.log("info", "commits panel requested");
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
    if (!isRequestMessage(value)) {
      this.host.log("warn", "ignored unknown page request");
      return;
    }

    let response: ResponseMessage;
    switch (value.command) {
      case "pageReady":
        this.state = this.persistent.load();
        this.repositories.discover();
        response = { command: "coreReady", runtime: "bones" };
        break;
      case "echo":
        response = {
          command: "echo",
          requestId: value.requestId,
          value: value.value,
          receivedAt: this.now().toISOString(),
        };
        break;
      case "osCapability":
        this.host.requestOs(value.requestId, value.action, value.value);
        return;
      case "loadRepository":
        this.loadRepository(value.path);
        return;
      case "refreshRepository":
        if (this.state.lastActiveRepository !== null) this.loadRepository(this.state.lastActiveRepository);
        return;
    }
    this.host.sendPageMessage(PANEL, response);
  }

  receiveOsResult(result: NativeResult): void {
    this.host.sendPageMessage(PANEL, { command: "osCapability", ...result });
  }

  receiveGitResult(result: GitResult): void {
    this.backend.receive(result);
  }

  panelOpened(): void {
    this.host.log("info", "commits panel opened");
  }

  panelClosed(): void {
    this.host.log("info", "commits panel closed");
  }

  panelFailed(reason: string): void {
    this.host.log("error", `commits panel failed: ${reason}`);
  }

  private loadRepository(path: string): void {
    const repository = this.repositories.addExternal(path);
    if (repository === null) return;
    this.state = this.persistent.save({ ...this.state, lastActiveRepository: repository.path });
    const settings = this.settings.load();
    this.backend.load(repository.path, settings.commitLimit, settings.includeRemotes);
  }

  private sendSnapshot(snapshot: RepositorySnapshot): void {
    this.host.sendPageMessage(PANEL, { command: "repositorySnapshot", ...snapshot });
  }
}
