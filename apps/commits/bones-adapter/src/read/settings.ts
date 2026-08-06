const PREFIX = "an-dr-com-mit-s.";
const COLOUR = /^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\s*\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))\s*$/;

type SettingKind = "boolean" | "number" | "string" | "colours" | "columns";
type SettingValue = boolean | number | string | readonly string[] | Readonly<Record<string, boolean>>;

/** One setting declared by the MIT extension manifest. */
export interface CoreSettingDefinition {
  readonly key: `${typeof PREFIX}${string}`;
  readonly kind: SettingKind;
  readonly defaultValue: SettingValue;
  readonly options?: readonly SettingValue[];
}

const shortcutOptions = ["UNASSIGNED", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `CTRL/CMD + ${letter}`)];
const setting = (key: string, kind: SettingKind, defaultValue: SettingValue, options?: readonly SettingValue[]): CoreSettingDefinition =>
  ({ key: `${PREFIX}${key}`, kind, defaultValue, options });

/** Complete configuration catalog from an-dr-com-mit-s/package.json. */
export const CORE_SETTING_DEFINITIONS: readonly CoreSettingDefinition[] = [
  setting("autoCenterCommitDetailsView", "boolean", true),
  setting("scmButtons.fetch", "boolean", true),
  setting("scmButtons.pull", "boolean", true),
  setting("scmButtons.push", "boolean", true),
  setting("repository.commits.committedVisual", "string", "Avatar", ["Avatar", "Initials"]),
  setting("repository.commits.avatar.mode", "string", "Auto (Fetched then Pattern)", ["Auto (Fetched then Pattern)", "Fetched Only", "Procedural Pattern", "Disabled"]),
  setting("repository.commits.avatar.size", "string", "Normal", ["Normal", "Small"]),
  setting("repository.commits.avatar.shape", "string", "Circle", ["Circle", "Square"]),
  setting("dateFormat", "string", "Date & Time", ["Date & Time", "Date Only", "Relative"]),
  setting("dateType", "string", "Author Date", ["Author Date", "Commit Date"]),
  setting("fetchAvatars", "boolean", false),
  setting("graphColours", "colours", ["#6ba2f2", "#ca3a7d", "#f3b33e", "#61aea6", "#ac70f7"]),
  setting("graphStyle", "string", "rounded", ["rounded", "angular"]),
  setting("initialLoadCommits", "number", 300),
  setting("loadMoreCommits", "number", 100),
  setting("maxDepthOfRepoSearch", "number", 0),
  setting("showCurrentBranchByDefault", "boolean", false),
  setting("showStatusBarItem", "boolean", true),
  setting("statusBarIconOnly", "boolean", true),
  setting("showUncommittedChanges", "boolean", true),
  setting("tabIconColourTheme", "string", "colour", ["colour", "grey"]),
  setting("blame.inlineMessageEnabled", "boolean", false),
  setting("inlineBlame.enabled", "boolean", false),
  setting("blame.inlineMessageFormat", "string", "Blame ${author.name} (${time.ago})"),
  setting("blame.inlineMessageNoCommit", "string", "Not Committed Yet"),
  setting("blame.inlineMessageMargin", "number", 2),
  setting("blame.currentUserAlias", "string", ""),
  setting("blame.ignoreWhitespace", "boolean", false),
  setting("blame.delayBlame", "number", 0),
  setting("blame.maxLineCount", "number", 16_384),
  setting("blame.extendedHoverInformation", "string", "off", ["off", "inline-status", "inline", "status"]),
  setting("blame.detectMoveOrCopyFromOtherFiles", "number", 0, [0, 1, 2, 3]),
  setting("logLevel", "string", "Info", ["Debug", "Info", "Warning", "Error"]),
  setting("statusBarItem.dirtyIndicator", "string", "+N -M", ["+N -M", "*", "none"]),
  setting("branchPanel.groupsFirst", "boolean", true),
  setting("branchPanel.flattenSingleChildGroups", "boolean", true),
  setting("dialog.repoInProgress.confirmAbort", "boolean", true),
  setting("uiDensity", "string", "Normal", ["Big", "Normal", "Compact"]),
  setting("repository.commits.columnVisibility", "columns", { Committed: true, ID: true }),
  setting("keyboardShortcut.refresh", "string", "CTRL/CMD + R", shortcutOptions),
];

export type DisplayMode = "system" | "light" | "dark";
/** Hour cycle for the compact commit-time display. "system" reads the OS/browser locale. */
export type TimeFormat = "system" | "12h" | "24h";

export type AppSettings = Readonly<Record<string, unknown>> & {
  readonly mode: DisplayMode;
  readonly lightTheme: string;
  readonly darkTheme: string;
  readonly timeFormat: TimeFormat;
};

export interface SettingsDocument {
  readonly version: 2;
  readonly core: Readonly<Record<string, unknown>>;
  readonly app: AppSettings;
}

export const DEFAULT_CORE_SETTINGS: Readonly<Record<string, unknown>> = Object.fromEntries(
  CORE_SETTING_DEFINITIONS.map((definition) => [definition.key, cloneValue(definition.defaultValue)]),
);

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mode: "system",
  lightTheme: "paper",
  darkTheme: "graphite",
  timeFormat: "system",
};

export const DEFAULT_SETTINGS: SettingsDocument = {
  version: 2,
  core: DEFAULT_CORE_SETTINGS,
  app: DEFAULT_APP_SETTINGS,
};

/** Parses, migrates, and normalizes a settings document. */
export function parseSettings(json: string): SettingsDocument {
  try {
    return validateSettings(JSON.parse(json) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Migrates v1 and validates known values while preserving unknown v2 keys. */
export function validateSettings(candidate: unknown): SettingsDocument {
  const value = isRecord(candidate) && isRecord(candidate.settings) ? candidate.settings : candidate;
  if (!isRecord(value)) return DEFAULT_SETTINGS;
  if (value.version === 1) return migrateVersionOne(value);
  if (value.version !== 2 || !isRecord(value.core) || !isRecord(value.app)) return DEFAULT_SETTINGS;

  const core: Record<string, unknown> = { ...value.core };
  for (const definition of CORE_SETTING_DEFINITIONS) {
    const candidateValue = value.core[definition.key];
    core[definition.key] = validates(definition, candidateValue)
      ? cloneValue(candidateValue as SettingValue)
      : cloneValue(definition.defaultValue);
  }
  const mode = value.app.mode;
  const timeFormat = value.app.timeFormat;
  return {
    version: 2,
    core,
    app: {
      ...value.app,
      mode: mode === "light" || mode === "dark" || mode === "system" ? mode : "system",
      lightTheme: typeof value.app.lightTheme === "string" ? value.app.lightTheme : "paper",
      darkTheme: typeof value.app.darkTheme === "string" ? value.app.darkTheme : "graphite",
      timeFormat: timeFormat === "12h" || timeFormat === "24h" ? timeFormat : "system",
    },
  };
}

function migrateVersionOne(value: Record<string, unknown>): SettingsDocument {
  const commitLimit = value.commitLimit;
  const theme = value.theme;
  return {
    ...DEFAULT_SETTINGS,
    core: {
      ...DEFAULT_CORE_SETTINGS,
      [`${PREFIX}initialLoadCommits`]: typeof commitLimit === "number" && Number.isFinite(commitLimit) ? commitLimit : 300,
    },
    app: {
      ...DEFAULT_APP_SETTINGS,
      mode: theme === "light" || theme === "dark" || theme === "system" ? theme : "system",
    },
  };
}

function validates(definition: CoreSettingDefinition, value: unknown): boolean {
  if (definition.options !== undefined) return definition.options.some((option) => Object.is(option, value));
  if (definition.kind === "boolean") return typeof value === "boolean";
  if (definition.kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (definition.kind === "string") return typeof value === "string";
  if (definition.kind === "colours") return Array.isArray(value) && value.every((colour) => typeof colour === "string" && COLOUR.test(colour));
  return isRecord(value)
    && Object.keys(value).every((key) => (key === "Committed" || key === "ID") && typeof value[key] === "boolean");
}

function cloneValue(value: SettingValue): SettingValue {
  if (Array.isArray(value)) return [...value];
  if (isRecord(value)) return { ...value } as Record<string, boolean>;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
