/**
 * Everything the core needs from whatever application is hosting it.
 *
 * The core never imports `vscode`; it asks the host through this port instead.
 * The VS Code extension is one implementation, a standalone Git client is
 * another, and the in-memory test host is a third.
 */

/** Something to stop listening with. Structurally compatible with vscode's. */
export interface Disposable {
  dispose(): void;
}

/** Reports which settings a configuration change touched. */
export interface ConfigChangeEvent {
  /**
   * @param namespace The setting namespace, e.g. the extension id or "git".
   * @param key Dotted key within the namespace; omitted asks about the whole namespace.
   */
  affects(namespace: string, key?: string): boolean;
}

export interface ConfigPort {
  /** The effective value, falling back when the setting is unset. */
  get<T>(namespace: string, key: string, fallback: T): T;
  /**
   * The value only if something set it explicitly, ignoring defaults. Used to
   * tell "the user chose this" from "this is what ships", which is how the
   * compatibility reader decides whether to fall back to the legacy namespace.
   */
  getExplicit<T>(namespace: string, key: string): T | undefined;
  onDidChange(listener: (event: ConfigChangeEvent) => void): Disposable;
}

/**
 * A key/value store. Shaped to match vscode's Memento so the extension can pass
 * one straight through, and simple enough for any host to implement over a JSON
 * file or a database.
 */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface StoragePort {
  /** Survives across workspaces — avatars, external repositories. */
  readonly global: KeyValueStore;
  /** Scoped to the open workspace — per-repository view state. */
  readonly workspace: KeyValueStore;
  /** Directory the host gives the core for its own files, if it has one. */
  readonly globalStoragePath: string;
}

export interface RootPathsChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface WorkspacePort {
  /** Directories to search for repositories. */
  getRootPaths(): string[];
  /** Reports which roots appeared and disappeared, so a scan can be incremental. */
  onDidChangeRootPaths(listener: (change: RootPathsChange) => void): Disposable;
  /**
   * An absolute path the user is currently working in, or null when the host
   * cannot tell. It need not be a repository root — the caller resolves it to
   * the repository containing it. VS Code answers with the active editor's
   * file; a standalone client answers with its selected repository.
   */
  getActiveRepoHint(): string | null;
  onDidChangeActiveRepoHint(listener: () => void): Disposable;
}

export interface WatcherPort {
  /**
   * Watches a repository for changes.
   * @param repoPath Absolute path of the repository root.
   * @param onChange Receives the absolute path of whatever changed.
   */
  watch(repoPath: string, onChange: (changedPath: string) => void): Disposable;
}

/** A save-file prompt, described without naming any toolkit's dialog type. */
export interface SavePrompt {
  /** Where the dialog opens and what it suggests saving as. */
  defaultPath: string;
  /** Button label, already localized by the caller. */
  saveLabel: string;
  /** Extension lists keyed by their localized description. */
  filters: Record<string, string[]>;
}

export interface UiPort {
  /** Reports a failure to the user. Never rejects. */
  showError(message: string): Promise<void>;
  copyToClipboard(text: string): Promise<boolean>;
  /** Opens a URL outside the application. Resolves false when refused. */
  openExternal(url: string): Promise<boolean>;
  /** Absolute path the user chose, or null when they cancelled. */
  promptForSavePath(prompt: SavePrompt): Promise<string | null>;
}

/** The whole host surface. Grows as each concern moves onto it. */
export interface HostPort {
  readonly config: ConfigPort;
  readonly storage: StoragePort;
  readonly workspace: WorkspacePort;
  readonly watcher: WatcherPort;
  readonly ui: UiPort;
}
