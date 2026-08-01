import { BonesHostPort } from "./host/bones-host-port";
import { CommitsCore } from "./commits-core";
import { pageHtml } from "./generated/page";
import {
  decodePageMessage,
  decodePanelClosed,
  decodePanelFailed,
  decodePanelOpened,
} from "@commits/ipc/web";
import { decodeGitResult, decodeNativeResult } from "@commits/ipc/native";

const OWNER = "commits";
const PANEL = "main";
const core = new CommitsCore(new BonesHostPort(), pageHtml);

export function init(): void {
  core.start();
}

export function shutdown(): void {
  core.stop();
}

export function onTick(_dt: number): void {}

export function onMessage(
  topic: string,
  _sender: string,
  payload: Uint8Array,
): Uint8Array | undefined {
  try {
    if (topic === "web/page-message") {
      const message = decodePageMessage(payload);
      if (message.owner === OWNER && message.panel === PANEL) {
        core.receivePageJson(message.json);
      }
    } else if (topic === "web/panel-opened") {
      const event = decodePanelOpened(payload);
      if (event.owner === OWNER && event.panel === PANEL) {
        core.panelOpened();
      }
    } else if (topic === "web/panel-closed") {
      const event = decodePanelClosed(payload);
      if (event.owner === OWNER && event.panel === PANEL) {
        core.panelClosed();
      }
    } else if (topic === "web/panel-failed") {
      const event = decodePanelFailed(payload);
      if (event.owner === OWNER && event.panel === PANEL) {
        core.panelFailed(event.reason);
      }
    } else if (topic === "os/result") {
      core.receiveOsResult(decodeNativeResult(payload));
    } else if (topic === "git/completed") {
      core.receiveGitResult(decodeGitResult(payload));
    } else if (topic === "os/prompt") {
      core.receivePrompt(new TextDecoder().decode(payload));
    }
  } catch (error) {
    new BonesHostPort().log("warn", `ignored invalid ${topic}: ${String(error)}`);
  }
  return undefined;
}

