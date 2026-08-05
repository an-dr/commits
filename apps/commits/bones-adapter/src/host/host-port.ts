export type LogLevel = "debug" | "info" | "warn" | "error";
export type PageSource =
  | { readonly kind: "html"; readonly value: string }
  | { readonly kind: "url"; readonly value: string };

export interface SettingsIoResult {
  readonly ok: boolean;
  readonly value: Uint8Array<ArrayBufferLike>;
  readonly error: string;
}

/** Host capabilities used by product behavior on bones and VS Code. */
export interface HostPort {
  closePanel(panel: string): void;
  log(level: LogLevel, message: string): void;
  openPanel(panel: string, source: PageSource): void;
  /**
   * Paths made available by the standalone host.
   *
   * This deliberately models paths, rather than VS Code workspace folders,
   * so the read backend can run in any bones host.
   */
  repositoryPaths(): readonly string[];
  /**
   * Webview page location supplied by the host at run time.
   *
   * The page is fetched rather than compiled in so rebuilding it does not
   * require rebuilding the component, matching how the VS Code extension host
   * supplies webview HTML.
   */
  loadPageSource(): PageSource;
  /** Reads the standalone user-facing settings document. */
  loadSettings(): SettingsIoResult;
  /** Atomically replaces the standalone user-facing settings document. */
  saveSettings(value: Uint8Array<ArrayBufferLike>): SettingsIoResult;
  /** Raw bytes persisted by bones in this component's file-backed save slot. */
  loadSavedState(): Uint8Array<ArrayBufferLike>;
  saveSavedState(value: Uint8Array<ArrayBufferLike>): void;
  runGit(request: import("@commits/ipc/native").GitRun): void;
  respondPrompt(id: string, value: string): void;
  requestOs(requestId: number, action: import("@commits/ipc/native").OsAction, value?: string): void;
  sendPageMessage(panel: string, message: unknown): void;
  subscribe(topic: string): void;
}
