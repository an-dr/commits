import type { SettingsStorage } from "./settings";

/** State kept across component restarts; all fields are optional by design. */
export interface PersistentState {
  readonly version: 1;
  readonly lastActiveRepository: string | null;
  readonly selectedCommit: string | null;
  readonly find: string;
  readonly findIsCaseSensitive: boolean;
  readonly findIsRegex: boolean;
}

export const DEFAULT_PERSISTENT_STATE: PersistentState = {
  version: 1,
  lastActiveRepository: null,
  selectedCommit: null,
  find: "",
  findIsCaseSensitive: false,
  findIsRegex: false,
};

/** Coexists with settings in the one component-owned bones save file. */
export class PersistentExtensionState {
  constructor(private readonly storage: SettingsStorage) {}

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
    selectedCommit,
    find: candidate.find,
    findIsCaseSensitive: candidate.findIsCaseSensitive,
    findIsRegex: candidate.findIsRegex,
  };
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
