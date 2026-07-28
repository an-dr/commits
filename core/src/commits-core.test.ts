import { describe, expect, it } from "vitest";
import { CommitsCore } from "./commits-core";
import type { HostPort, LogLevel } from "./host/host-port";

class StubHost implements HostPort {
  readonly closed: string[] = [];
  readonly logs: Array<[LogLevel, string]> = [];
  readonly opened: Array<[string, string]> = [];
  readonly sent: Array<[string, unknown]> = [];
  readonly topics: string[] = [];

  closePanel(panel: string): void {
    this.closed.push(panel);
  }
  log(level: LogLevel, message: string): void {
    this.logs.push([level, message]);
  }
  openPanel(panel: string, html: string): void {
    this.opened.push([panel, html]);
  }
  sendPageMessage(panel: string, message: unknown): void {
    this.sent.push([panel, message]);
  }
  subscribe(topic: string): void {
    this.topics.push(topic);
  }
}

describe("CommitsCore", () => {
  it("opens the page through HostPort and echoes a typed request", () => {
    const host = new StubHost();
    const core = new CommitsCore(
      host,
      "<main>walking skeleton</main>",
      () => new Date("2026-07-28T12:00:00.000Z"),
    );

    core.start();
    core.receivePageJson(
      JSON.stringify({ command: "echo", requestId: 7, value: "bones" }),
    );

    expect(host.opened).toEqual([["main", "<main>walking skeleton</main>"]]);
    expect(host.topics).toEqual(["web/*"]);
    expect(host.sent).toEqual([
      [
        "main",
        {
          command: "echo",
          requestId: 7,
          value: "bones",
          receivedAt: "2026-07-28T12:00:00.000Z",
        },
      ],
    ]);
  });

  it("has no bones dependency in its host-agnostic behavior", () => {
    const host = new StubHost();
    const core = new CommitsCore(host, "<main></main>");

    core.receivePageJson("{not json");

    expect(host.logs).toContainEqual(["warn", "ignored malformed page JSON"]);
  });
});

