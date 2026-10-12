import {
  log as hostLog,
  publish,
  send,
  subscribe as hostSubscribe,
} from "bones:extension/host-api@1.0.0";
import {
  encodeClosePanel,
  encodeOpenPanel,
  encodeSendJson,
} from "@commits/ipc/web";
import type { CommitsRepoStatus, HostPort, InstallStatus, LaunchRepository, LogLevel, PageSource, SettingsIoResult } from "./host-port";
import {
  encodeGitRun,
  decodeLaunchRequest,
  encodeOsRequest,
  encodeRepoOsRequest,
  encodeWatchRequest,
  type GitRun,
  type OsAction,
  type RepoOsAction,
  type UpdaterAction,
} from "@commits/ipc/native";

export class BonesHostPort implements HostPort {
  closePanel(panel: string): void {
    this.sendWeb(encodeClosePanel(panel));
  }

  log(level: LogLevel, message: string): void {
    hostLog(level, message);
  }

  openPanel(panel: string, source: PageSource): void {
    this.sendWeb(encodeOpenPanel(panel, source));
  }

  repositoryPaths(): readonly string[] {
    // A path becomes available through the folder picker or a future bones
    // launcher capability. The core owns remembered external paths.
    return [];
  }

  loadPageSource(): PageSource {
    try {
      const page = send("page", new Uint8Array());
      if (page.length === 0) {
        hostLog("error", "host did not provide a page URL");
        return { kind: "html", value: "<p>Unable to load the Commits page.</p>" };
      }
      return { kind: "url", value: new TextDecoder().decode(page) };
    } catch (error) {
      hostLog("error", `could not load the page: ${String(error)}`);
      return { kind: "html", value: "<p>Unable to load the Commits page.</p>" };
    }
  }

  loadSavedState(): Uint8Array<ArrayBufferLike> {
    try {
      return send("persistence", new Uint8Array());
    } catch (error) {
      hostLog("warn", `could not load persisted state: ${String(error)}`);
      return new Uint8Array();
    }
  }

  loadSettings(): SettingsIoResult {
    return this.requestSettings(new Uint8Array([0]));
  }

  saveSettings(value: Uint8Array<ArrayBufferLike>): SettingsIoResult {
    const request = new Uint8Array(value.length + 1);
    request[0] = 1;
    request.set(value, 1);
    return this.requestSettings(request);
  }

  saveSavedState(value: Uint8Array<ArrayBufferLike>): void {
    publish("persistence/save", value);
  }

  commitsRepoStatus(): CommitsRepoStatus {
    const failed = (error: string): CommitsRepoStatus =>
      ({ ok: false, exists: false, path: "", parentPath: "", error });
    try {
      const response = send("commits-repo", new Uint8Array());
      if (response[0] !== 0) {
        return failed(response.length > 1
          ? new TextDecoder().decode(response.slice(1))
          : "commits repo host returned an invalid response");
      }
      const text = new TextDecoder().decode(response.slice(2));
      const separator = text.indexOf("\n");
      if (separator < 0) return failed("commits repo host returned a malformed path");
      return {
        ok: true,
        exists: response[1] === 1,
        parentPath: text.slice(0, separator),
        path: text.slice(separator + 1),
        error: "",
      };
    } catch (error) {
      return failed(String(error));
    }
  }

  /**
   * Asks the host what the command line named. The first byte says which of
   * the three cases this is; the rest is the newline-separated repositories
   * found there, or the reason nothing was.
   *
   * A failed send is reported as "none" rather than as a refusal: the host
   * not answering says nothing about what the user typed, and inventing a
   * reason to show them would be worse than showing the plain chooser.
   */
  launchRepository(): LaunchRepository {
    let response: Uint8Array;
    try {
      response = send("launch", new Uint8Array());
    } catch (error) {
      hostLog("warn", `could not read the launch argument: ${String(error)}`);
      return { kind: "none" };
    }
    if (response.length === 0) return { kind: "none" };
    return decodeLaunchRequest(response);
  }

  repositorySources(): readonly import("./host-port").RepositorySource[] {
    try { return JSON.parse(new TextDecoder().decode(send("sources", new Uint8Array()))); }
    catch (error) { hostLog("warn", `could not read repository sources: ${String(error)}`); return []; }
  }

  repositoryState(path: string): import("../health/facts").RepositoryState {
    try { return JSON.parse(new TextDecoder().decode(send("launch", new TextEncoder().encode(path)))); }
    catch (error) { hostLog("warn", `could not check repository state: ${String(error)}`); return { exists: false, isRepo: false, operation: null }; }
  }

  runGit(request: GitRun): void {
    publish("git/request", encodeGitRun(request));
  }

  respondPrompt(id: string, value: string): void { publish("os/prompt-response", new TextEncoder().encode(`${id}\n${value}`)); }

  requestOs(requestId: number, action: OsAction, value = ""): void {
    publish("os/request", encodeOsRequest(requestId, action, value));
  }

  requestRepoOs(requestId: number, action: RepoOsAction, value = ""): void {
    publish("repo-os/request", encodeRepoOsRequest(requestId, action, value));
  }

  requestUpdate(requestId: number, action: UpdaterAction): void {
    const tags = { check: 0, stage: 1, install: 2, register: 0, unregister: 1 };
    const bytes = new Uint8Array(5);
    new DataView(bytes.buffer).setUint32(0, requestId, true);
    bytes[4] = tags[action];
    publish(action === "register" || action === "unregister" ? "desktop/request" : "upgrader/request", bytes);
  }

  watchRepository(requestId: number, action: "start" | "stop", repository: string): void {
    publish("watcher/request", encodeWatchRequest(requestId, action, repository));
  }

  installStatus(): InstallStatus {
    const failed = (error: string): InstallStatus => ({ ok: false, installed: false, registered: false, justUpdated: false, version: "", error });
    try {
      const response = send("installation", new Uint8Array());
      if (response[0] !== 0) {
        return failed(response.length > 1
          ? new TextDecoder().decode(response.slice(1))
          : "updater host returned an invalid response");
      }
      return {
        ok: true,
        installed: response[1] === 1,
        justUpdated: response[2] === 1,
        registered: response[3] === 1,
        version: new TextDecoder().decode(response.slice(4)),
        error: "",
      };
    } catch (error) {
      return failed(String(error));
    }
  }

  requestLastApplied(requestId: number): void {
    const bytes = new Uint8Array(5);
    new DataView(bytes.buffer).setUint32(0, requestId, true);
    bytes[4] = 3;
    publish("upgrader/request", bytes);
  }

  sendPageMessage(panel: string, message: unknown): void {
    this.sendWeb(encodeSendJson(panel, JSON.stringify(message)));
  }

  subscribe(topic: string): void {
    hostSubscribe(topic);
  }

  private sendWeb(payload: Uint8Array): void {
    try {
      send("web", payload);
    } catch (error) {
      hostLog("error", `web command failed: ${String(error)}`);
    }
  }

  private requestSettings(payload: Uint8Array): SettingsIoResult {
    try {
      const response = send("settings", payload);
      if (response[0] === 0) return { ok: true, value: response.slice(1), error: "" };
      const error = response.length > 1
        ? new TextDecoder().decode(response.slice(1))
        : "settings host returned an invalid response";
      return { ok: false, value: new Uint8Array(), error };
    } catch (error) {
      return { ok: false, value: new Uint8Array(), error: String(error) };
    }
  }
}
