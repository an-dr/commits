export type LogLevel = "debug" | "info" | "warn" | "error";

/** Host capabilities used by product behavior on bones and VS Code. */
export interface HostPort {
  closePanel(panel: string): void;
  log(level: LogLevel, message: string): void;
  openPanel(panel: string, html: string): void;
  /**
   * Paths made available by the standalone host.
   *
   * This deliberately models paths, rather than VS Code workspace folders,
   * so the read backend can run in any bones host.
   */
  repositoryPaths(): readonly string[];
  /** Raw bytes persisted by bones in this component's file-backed save slot. */
  loadSavedState(): Uint8Array<ArrayBufferLike>;
  saveSavedState(value: Uint8Array<ArrayBufferLike>): void;
  runGit(request: import("../../../ipc/ts/native").GitRun): void;
  respondPrompt(id: string, value: string): void;
  requestOs(requestId: number, action: import("../../../ipc/ts/native").OsAction, value?: string): void;
  sendPageMessage(panel: string, message: unknown): void;
  subscribe(topic: string): void;
}
