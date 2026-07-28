import type { HostPort } from "./host/host-port";
import { isRequestMessage, type ResponseMessage } from "./protocol";
import type { NativeResult } from "../../proto/ts/native";

const PANEL = "main";

/** Host-independent owner of page lifecycle and request dispatch. */
export class CommitsCore {
  constructor(
    private readonly host: HostPort,
    private readonly pageHtml: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    this.host.subscribe("web/*");
    this.host.subscribe("os/result");
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
    }
    this.host.sendPageMessage(PANEL, response);
  }

  receiveOsResult(result: NativeResult): void {
    this.host.sendPageMessage(PANEL, { command: "osCapability", ...result });
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
}
