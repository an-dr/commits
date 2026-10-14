import type { DesktopAction, GitRun, LaunchRequest, OsAction, RepoOsAction, UpdaterAction } from "@commits/ipc/native";
import type { HealthFacts } from "../health/verdict";

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

export interface InstallStatus {
  readonly ok: boolean;
  /** Whether this run's own directory is the canonical install location. */
  readonly installed: boolean;
  /** Whether the installed app is registered with the desktop; never set for a run that is not installed. */
  readonly registered: boolean;
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
  /**
   * What the command line asked for, as the host resolved it: the repository
   * outcome (none, the repositories found at or below the path with the first
   * to open, or why the path was refused) plus navigation and appearance
   * options. Startup and later handoffs use this same shape.
   */
  launchRequest(): LaunchRequest;
  /** Repository lists other programs offer through source files; read-only, last good parse per file. */
  repositorySources(): readonly RepositorySource[];
  /** Whether a path exists, is a repository, and which Git operation is in progress there, read natively. */
  repositoryState(path: string): RepositoryState;
  /** Raw bytes persisted by bones in this component's file-backed save slot. */
  loadSavedState(): Uint8Array<ArrayBufferLike>;
  saveSavedState(value: Uint8Array<ArrayBufferLike>): void;
  runGit(request: GitRun): void;
  respondPrompt(id: string, value: string): void;
  requestOs(requestId: number, action: OsAction, value?: string): void;
  /**
   * Asks the git-aware endpoint, whose actions all need a repository.
   *
   * Separate from `requestOs` because that endpoint is the engine's generic
   * desktop surface, which knows nothing about repositories. Results from both
   * arrive the same way, correlated by request id.
   */
  requestRepoOs(
    requestId: number,
    action: RepoOsAction,
    value?: string,
  ): void;

  /**
   * Starts or stops watching a repository for changes made outside the app.
   * Events come back on the `repo/full-refresh` and `repo/lightweight-refresh`
   * topics, correlated by `requestId`.
   */
  watchRepository(requestId: number, action: "start" | "stop", repository: string): void;
  /** Checks a manifest for a newer version, stages its verified asset, or stages the running build itself. */
  requestUpdate(requestId: number, action: UpdaterAction): void;
  /** Registers or unregisters the installed entry point through Bones' desktop module. */
  requestDesktop(requestId: number, action: DesktopAction): void;
  /** Whether this running build is the one installed at the canonical location. */
  installStatus(): InstallStatus;
  /** Asks Bones' upgrade module which version last ran, answered on `upgrader/result`. */
  requestLastApplied(requestId: number): void;
  sendPageMessage(panel: string, message: unknown): void;
  subscribe(topic: string): void;
}

/** One source file's repositories; see docs/repository-sources.md. */
export interface RepositorySource {
  readonly name: string;
  readonly repositories: readonly SourceRepository[];
}

export interface SourceRepository {
  readonly name: string;
  readonly path: string;
  readonly group?: string | null;
  readonly favorite?: boolean;
  /** False when the folder is missing, so the selector shows it but cannot open it. */
  readonly available: boolean;
}

/** Native facts about a path that Git itself cannot report for a missing folder. */
export interface RepositoryState {
  readonly exists: boolean;
  readonly isRepo: boolean;
  readonly operation: HealthFacts["operation"];
}
