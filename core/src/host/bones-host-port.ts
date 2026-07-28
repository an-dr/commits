import {
  log as hostLog,
  publish,
  send,
  subscribe as hostSubscribe,
} from "bones:core/host-api@0.1.0";
import {
  encodeClosePanel,
  encodeOpenPanel,
  encodeSendJson,
} from "../../../proto/ts/web";
import type { HostPort, LogLevel } from "./host-port";
import { encodeOsRequest, type OsAction } from "../../../proto/ts/native";

export class BonesHostPort implements HostPort {
  closePanel(panel: string): void {
    this.sendWeb(encodeClosePanel(panel));
  }

  log(level: LogLevel, message: string): void {
    hostLog(level, message);
  }

  openPanel(panel: string, html: string): void {
    this.sendWeb(encodeOpenPanel(panel, { kind: "html", value: html }));
  }

  repositoryPaths(): readonly string[] {
    // A path becomes available through the folder picker or a future bones
    // launcher capability. The core owns remembered external paths.
    return [];
  }

  loadSavedState(): Uint8Array<ArrayBufferLike> {
    try {
      return send("persistence", new Uint8Array());
    } catch (error) {
      hostLog("warn", `could not load persisted state: ${String(error)}`);
      return new Uint8Array();
    }
  }

  saveSavedState(value: Uint8Array<ArrayBufferLike>): void {
    publish("persistence/save", value);
  }

  requestOs(requestId: number, action: OsAction, value = ""): void {
    publish("os/request", encodeOsRequest(requestId, action, value));
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
}
