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
