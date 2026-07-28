export type LogLevel = "debug" | "info" | "warn" | "error";

/** Host capabilities used by product behavior on bones and VS Code. */
export interface HostPort {
  closePanel(panel: string): void;
  log(level: LogLevel, message: string): void;
  openPanel(panel: string, html: string): void;
  sendPageMessage(panel: string, message: unknown): void;
  subscribe(topic: string): void;
}
