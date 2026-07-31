import type {
  ConfigChangeEvent,
  Disposable,
  HostPort,
  KeyValueStore,
  RootPathsChange,
  SavePrompt
} from "./port";

/** A store backed by a plain object. */
function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string, fallback?: T): T {
      return (values.has(key) ? values.get(key) : fallback) as T;
    },
    update(key: string, value: unknown) {
      values.set(key, value);
      return Promise.resolve();
    }
  };
}

export interface MemoryHostOptions {
  /** Settings keyed as "namespace.dotted.key". */
  settings?: Record<string, unknown>;
  /** Which of those the user set explicitly, rather than shipped defaults. */
  explicitSettings?: Record<string, unknown>;
  rootPaths?: string[];
  activeRepoHint?: string | null;
  globalStoragePath?: string;
}

/**
 * A HostPort with no editor behind it.
 *
 * Its purpose is to prove the core runs outside VS Code — it is the smallest
 * possible second implementation, and anything the core needs that cannot be
 * expressed here is a leak the lint rule cannot see.
 */
export function createMemoryHost(options: MemoryHostOptions = {}) {
  const settings = new Map<string, unknown>(Object.entries(options.settings ?? {}));
  const explicit = new Map<string, unknown>(Object.entries(options.explicitSettings ?? {}));
  const configListeners: ((event: ConfigChangeEvent) => void)[] = [];
  const rootListeners: ((change: RootPathsChange) => void)[] = [];
  const hintListeners: (() => void)[] = [];
  const watched = new Map<string, (changedPath: string) => void>();

  let rootPaths = [...(options.rootPaths ?? [])];
  let activeRepoHint = options.activeRepoHint ?? null;

  const errors: string[] = [];
  const clipboard: string[] = [];
  const opened: string[] = [];
  let savePathAnswer: string | null = null;

  const port: HostPort = {
    config: {
      get: <T>(namespace: string, key: string, fallback: T): T =>
        (settings.get(`${namespace}.${key}`) as T | undefined) ?? fallback,
      getExplicit: <T>(namespace: string, key: string): T | undefined =>
        explicit.get(`${namespace}.${key}`) as T | undefined,
      onDidChange(listener) {
        configListeners.push(listener);
        return { dispose: () => configListeners.splice(configListeners.indexOf(listener), 1) };
      }
    },
    storage: {
      global: createMemoryStore(),
      workspace: createMemoryStore(),
      globalStoragePath: options.globalStoragePath ?? "/tmp/commits-core"
    },
    workspace: {
      getRootPaths: () => [...rootPaths],
      onDidChangeRootPaths(listener) {
        rootListeners.push(listener);
        return { dispose: () => rootListeners.splice(rootListeners.indexOf(listener), 1) };
      },
      getActiveRepoHint: () => activeRepoHint,
      onDidChangeActiveRepoHint(listener) {
        hintListeners.push(listener);
        return { dispose: () => hintListeners.splice(hintListeners.indexOf(listener), 1) };
      }
    },
    watcher: {
      watch(repoPath: string, onChange: (changedPath: string) => void): Disposable {
        watched.set(repoPath, onChange);
        return { dispose: () => watched.delete(repoPath) };
      }
    },
    ui: {
      showError(message: string) {
        errors.push(message);
        return Promise.resolve();
      },
      copyToClipboard(text: string) {
        clipboard.push(text);
        return Promise.resolve(true);
      },
      openExternal(url: string) {
        opened.push(url);
        return Promise.resolve(true);
      },
      promptForSavePath(_prompt: SavePrompt) {
        return Promise.resolve(savePathAnswer);
      }
    }
  };

  return {
    port,
    /** What the host was asked to show or do. */
    errors,
    clipboard,
    opened,
    /** Repositories currently being watched. */
    watchedRepos: () => [...watched.keys()],
    /** Drives a change as if the file system reported one. */
    emitFileChange(repoPath: string, changedPath: string) {
      watched.get(repoPath)?.(changedPath);
    },
    setSetting(namespacedKey: string, value: unknown, explicitly = false) {
      settings.set(namespacedKey, value);
      if (explicitly) {
        explicit.set(namespacedKey, value);
      }
      for (const listener of configListeners.slice()) {
        listener({
          affects: (namespace, key) =>
            namespacedKey === (key === undefined ? namespace : `${namespace}.${key}`)
        });
      }
    },
    setRootPaths(next: string[]) {
      const added = next.filter((p) => !rootPaths.includes(p));
      const removed = rootPaths.filter((p) => !next.includes(p));
      rootPaths = [...next];
      for (const listener of rootListeners.slice()) {
        listener({ added, removed });
      }
    },
    setActiveRepoHint(next: string | null) {
      activeRepoHint = next;
      for (const listener of hintListeners.slice()) {
        listener();
      }
    },
    answerSavePathWith(next: string | null) {
      savePathAnswer = next;
    }
  };
}
