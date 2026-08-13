export type LogLevel = "debug" | "info" | "warn" | "error";
export type PageSource =
  | { readonly kind: "html"; readonly value: string }
  | { readonly kind: "url"; readonly value: string };

export interface SettingsIoResult {
  readonly ok: boolean;
  readonly value: Uint8Array<ArrayBufferLike>;
  readonly error: string;
}

export interface CommitsRepoStatus {
  readonly ok: boolean;
  readonly exists: boolean;
  /** Absolute path to the clone, e.g. `~/.commits/repo`. */
  readonly path: string;
  /** Absolute path to `path`'s parent (`~/.commits`), which a clone spawns `git` into. */
  readonly parentPath: string;
  readonly error: string;
}

/**
 * What `commits <path>` asked for, as the host resolved it.
 *
 * Three cases rather than a nullable path: "started with no argument" and
 * "started with an argument I refused" lead to the same screen but not the
 * same message, and only the host can tell them apart.
 */
export type LaunchRepository =
  | { readonly kind: "none" }
  | { readonly kind: "repository"; readonly path: string }
  | { readonly kind: "rejected"; readonly reason: string };

export interface InstallStatus {
  readonly ok: boolean;
  /** Whether this run's own directory is the canonical install location. */
  readonly installed: boolean;
  /** Whether this is the first start since the running version last changed. */
  readonly justUpdated: boolean;
  /** This build's own version, shown in the About menu. */
  readonly version: string;
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
  /** Whether the commits project's own clone (`~/.commits/repo`) exists, and its resolved path. */
  commitsRepoStatus(): CommitsRepoStatus;
  /** The repository named on the command line, already resolved and checked by the host. */
  launchRepository(): LaunchRepository;
  /** Raw bytes persisted by bones in this component's file-backed save slot. */
  loadSavedState(): Uint8Array<ArrayBufferLike>;
  saveSavedState(value: Uint8Array<ArrayBufferLike>): void;
  runGit(request: import("@commits/ipc/native").GitRun): void;
  respondPrompt(id: string, value: string): void;
  requestOs(requestId: number, action: import("@commits/ipc/native").OsAction, value?: string): void;
  /** Checks a manifest for a newer version, stages its verified asset, or stages the running build itself. */
  requestUpdate(requestId: number, action: import("@commits/ipc/native").UpdaterAction, manifestUrl: string): void;
  /** Whether this running build is the one installed at the canonical location. */
  installStatus(): InstallStatus;
  sendPageMessage(panel: string, message: unknown): void;
  subscribe(topic: string): void;
}
