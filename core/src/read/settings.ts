/** Versioned, host-neutral user settings stored as UTF-8 JSON in bones persistence. */
export interface Settings {
  readonly version: 1;
  readonly commitLimit: number;
  readonly includeRemotes: boolean;
  readonly theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  commitLimit: 250,
  includeRemotes: true,
  theme: "system",
};

export interface SettingsStorage {
  load(): Uint8Array<ArrayBufferLike>;
  save(value: Uint8Array<ArrayBufferLike>): void;
}

export class FileBackedSettings {
  constructor(private readonly storage: SettingsStorage) {}

  load(): Settings {
    const bytes = this.storage.load();
    if (bytes.byteLength === 0) return DEFAULT_SETTINGS;
    try {
      return parseSettings(new TextDecoder().decode(bytes));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  save(candidate: unknown): Settings {
    const settings = validateSettings(candidate);
    this.storage.save(new TextEncoder().encode(JSON.stringify(settings)));
    return settings;
  }
}

export function parseSettings(json: string): Settings {
  return validateSettings(JSON.parse(json));
}

export function validateSettings(candidate: unknown): Settings {
  if (!isRecord(candidate) || candidate.version !== 1) return DEFAULT_SETTINGS;
  const commitLimit = candidate.commitLimit;
  const includeRemotes = candidate.includeRemotes;
  const theme = candidate.theme;
  if (typeof commitLimit !== "number" || !Number.isSafeInteger(commitLimit) || commitLimit < 10 || commitLimit > 2_000) {
    return DEFAULT_SETTINGS;
  }
  if (typeof includeRemotes !== "boolean") return DEFAULT_SETTINGS;
  if (theme !== "system" && theme !== "light" && theme !== "dark") return DEFAULT_SETTINGS;
  return { version: 1, commitLimit, includeRemotes, theme };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
