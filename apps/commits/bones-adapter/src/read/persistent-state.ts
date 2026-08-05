interface StateStorage {
  load(): Uint8Array<ArrayBufferLike>;
  save(value: Uint8Array<ArrayBufferLike>): void;
}

/** State kept across component restarts; all fields are optional by design. */
export interface PersistentState {
  readonly version: 1;
  readonly lastActiveRepository: string | null;
  /** Most recently opened repositories, newest first. */
  readonly recentRepositories: readonly string[];
  readonly selectedCommit: string | null;
  readonly find: string;
  readonly findIsCaseSensitive: boolean;
  readonly findIsRegex: boolean;
}

export const DEFAULT_PERSISTENT_STATE: PersistentState = {
  version: 1,
  lastActiveRepository: null,
  recentRepositories: [],
  selectedCommit: null,
  find: "",
  findIsCaseSensitive: false,
  findIsRegex: false,
};

/** Coexists with settings in the one component-owned bones save file. */
export class PersistentExtensionState {
  constructor(private readonly storage: StateStorage) {}

  load(): PersistentState {
    try {
      const document = decode(this.storage.load());
      return validateState(document.state);
    } catch {
      return DEFAULT_PERSISTENT_STATE;
    }
  }

  save(candidate: unknown): PersistentState {
    const state = validateState(candidate);
    const document = decodeSafely(this.storage.load());
    this.storage.save(new TextEncoder().encode(JSON.stringify({
      // Settings predating the state envelope were stored as the whole file.
      settings: document.settings ?? document,
      state,
    })));
    return state;
  }
}

export function validateState(candidate: unknown): PersistentState {
  if (!isRecord(candidate) || candidate.version !== 1) return DEFAULT_PERSISTENT_STATE;
  const lastActiveRepository = nullableString(candidate.lastActiveRepository);
  const selectedCommit = nullableString(candidate.selectedCommit);
  if (lastActiveRepository === undefined || selectedCommit === undefined
    || typeof candidate.find !== "string" || candidate.find.length > 1_000
    || typeof candidate.findIsCaseSensitive !== "boolean" || typeof candidate.findIsRegex !== "boolean") {
    return DEFAULT_PERSISTENT_STATE;
  }
  return {
    version: 1,
    lastActiveRepository,
    // Absent in saves written before recent repositories existed.
    recentRepositories: validateRecents(candidate.recentRepositories),
    selectedCommit,
    find: candidate.find,
    findIsCaseSensitive: candidate.findIsCaseSensitive,
    findIsRegex: candidate.findIsRegex,
  };
}

/** Longest recent-repository list kept, oldest entries dropped first. */
export const MAX_RECENT_REPOSITORIES = 10;

function validateRecents(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry === "" || entry.length > 1_000) continue;
    if (!paths.includes(entry)) paths.push(entry);
    if (paths.length === MAX_RECENT_REPOSITORIES) break;
  }
  return paths;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function decode(bytes: Uint8Array<ArrayBufferLike>): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(value)) throw new Error("state document must be an object");
  return value;
}

function decodeSafely(bytes: Uint8Array<ArrayBufferLike>): Record<string, unknown> {
  try { return decode(bytes); } catch { return {}; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
