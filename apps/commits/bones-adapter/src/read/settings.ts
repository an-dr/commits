const PREFIX = "an-dr-com-mit-s.";
const COLOUR = /^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\s*\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))\s*$/;

type SettingKind = "boolean" | "number" | "string" | "colours" | "columns";
type SettingValue = boolean | number | string | readonly string[] | Readonly<Record<string, boolean>>;

/** One of the groups a settings UI can show core definitions under. */
export type SettingSection =
  | "General"
  | "Toolbar"
  | "Commits Table"
  | "Graph"
  | "Status Bar"
  | "Blame"
  | "Branches";

/** One setting declared by the MIT extension manifest. */
export interface CoreSettingDefinition {
  readonly key: `${typeof PREFIX}${string}`;
  readonly kind: SettingKind;
  readonly section: SettingSection;
  readonly description: string;
  readonly defaultValue: SettingValue;
  readonly options?: readonly SettingValue[];
  /** False for a key nothing in the standalone app reads -- it still round-trips through
   *  the persisted document, but a settings UI should not show a control for it. */
  readonly standalone: boolean;
}

// Keys meaningful only to the VS Code extension: its own status bar item,
// inline editor blame, its SCM view's toolbar buttons, and its Node backend's
// repo-search/date-type/uncommitted-changes handling (packages/core/src/backend,
// which the standalone app never invokes -- see docs/shared-core.md). Verified
// by grepping apps/ and packages/core/src/webview for each key: zero hits
// outside this file for every one of these.
const VSCODE_ONLY_KEYS: ReadonlySet<string> = new Set([
  "scmButtons.fetch",
  "scmButtons.pull",
  "scmButtons.push",
  "dateType",
  "maxDepthOfRepoSearch",
  "showStatusBarItem",
  "statusBarIconOnly",
  "showUncommittedChanges",
  "tabIconColourTheme",
  "blame.inlineMessageEnabled",
  "inlineBlame.enabled",
  "blame.inlineMessageFormat",
  "blame.inlineMessageNoCommit",
  "blame.inlineMessageMargin",
  "blame.currentUserAlias",
  "blame.ignoreWhitespace",
  "blame.delayBlame",
  "blame.maxLineCount",
  "blame.extendedHoverInformation",
  "blame.detectMoveOrCopyFromOtherFiles",
  "logLevel",
  "statusBarItem.dirtyIndicator",
]);

const shortcutOptions = ["UNASSIGNED", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `CTRL/CMD + ${letter}`)];
const setting = (
  key: string,
  kind: SettingKind,
  section: SettingSection,
  description: string,
  defaultValue: SettingValue,
  options?: readonly SettingValue[],
): CoreSettingDefinition => ({
  key: `${PREFIX}${key}`,
  kind,
  section,
  description,
  defaultValue,
  options,
  standalone: !VSCODE_ONLY_KEYS.has(key),
});

/** Complete configuration catalog from an-dr-com-mit-s/package.json. */
export const CORE_SETTING_DEFINITIONS: readonly CoreSettingDefinition[] = [
  setting("autoCenterCommitDetailsView", "boolean", "General", "Keeps the selected commit's details centered in view when the graph scrolls.", true),
  setting("scmButtons.fetch", "boolean", "Toolbar", "Shows the Fetch button in the source control toolbar.", true),
  setting("scmButtons.pull", "boolean", "Toolbar", "Shows the Pull button in the source control toolbar.", true),
  setting("scmButtons.push", "boolean", "Toolbar", "Shows the Push button in the source control toolbar.", true),
  setting("repository.commits.committedVisual", "string", "Commits Table", "How each commit's author is shown in the Committed column: an avatar image or initials.", "Avatar", ["Avatar", "Initials"]),
  setting("repository.commits.avatar.mode", "string", "Commits Table", "Where avatar images come from: fetched online, generated locally, or disabled.", "Auto (Fetched then Pattern)", ["Auto (Fetched then Pattern)", "Fetched Only", "Procedural Pattern", "Disabled"]),
  setting("repository.commits.avatar.size", "string", "Commits Table", "Size of author avatars in the commits table.", "Normal", ["Normal", "Small"]),
  setting("repository.commits.avatar.shape", "string", "Commits Table", "Shape of author avatars in the commits table.", "Circle", ["Circle", "Square"]),
  setting("dateFormat", "string", "Commits Table", 'How commit dates are displayed: full date and time, date only, or relative (e.g. "3 days ago").', "Date & Time", ["Date & Time", "Date Only", "Relative"]),
  setting("dateType", "string", "Commits Table", "Which Git date is shown: the author date or the commit date.", "Author Date", ["Author Date", "Commit Date"]),
  setting("fetchAvatars", "boolean", "Commits Table", "Allows fetching author avatar images from Gravatar over the network.", true),
  setting("graphColours", "colours", "Graph", "Colour palette cycled across the commit graph's branch lines.", ["#6ba2f2", "#ca3a7d", "#f3b33e", "#61aea6", "#ac70f7"]),
  setting("graphStyle", "string", "Graph", "Corner style of the commit graph's branch lines: rounded or angular.", "rounded", ["rounded", "angular"]),
  setting("initialLoadCommits", "number", "Graph", "How many commits to load when a repository is first opened.", 300),
  setting("loadMoreCommits", "number", "Graph", "How many additional commits to load each time more are requested.", 100),
  setting("maxDepthOfRepoSearch", "number", "General", "How many folder levels deep to search for repositories; 0 searches without a limit.", 0),
  setting("showCurrentBranchByDefault", "boolean", "Graph", "Filters the graph to the current branch by default when a repository opens.", false),
  setting("showStatusBarItem", "boolean", "Status Bar", "Shows a Commits item in the status bar.", true),
  setting("statusBarIconOnly", "boolean", "Status Bar", "Shows only an icon in the status bar item, without a text label.", true),
  setting("showUncommittedChanges", "boolean", "Graph", "Shows an entry for uncommitted changes at the top of the commit graph.", true),
  setting("tabIconColourTheme", "string", "Status Bar", "Colour theme used for the status bar's icon.", "colour", ["colour", "grey"]),
  setting("blame.inlineMessageEnabled", "boolean", "Blame", "Shows an inline blame message at the cursor in the editor.", false),
  setting("inlineBlame.enabled", "boolean", "Blame", "Enables the inline blame feature.", false),
  setting("blame.inlineMessageFormat", "string", "Blame", "Template for the inline blame message text.", "Blame ${author.name} (${time.ago})"),
  setting("blame.inlineMessageNoCommit", "string", "Blame", "Inline blame text shown for lines that have not been committed yet.", "Not Committed Yet"),
  setting("blame.inlineMessageMargin", "number", "Blame", "Left margin, in characters, before the inline blame message.", 2),
  setting("blame.currentUserAlias", "string", "Blame", "Name shown for your own commits in blame, in place of your Git author name.", ""),
  setting("blame.ignoreWhitespace", "boolean", "Blame", "Ignores whitespace-only changes when attributing blame.", false),
  setting("blame.delayBlame", "number", "Blame", "Milliseconds to wait after the cursor stops moving before showing inline blame.", 0),
  setting("blame.maxLineCount", "number", "Blame", "Skips inline blame for files with more than this many lines.", 16_384),
  setting("blame.extendedHoverInformation", "string", "Blame", "What extra detail the blame hover shows: status, commit message, both, or neither.", "off", ["off", "inline-status", "inline", "status"]),
  setting("blame.detectMoveOrCopyFromOtherFiles", "number", "Blame", "How hard to look for a line's origin in other files when it was moved or copied.", 0, [0, 1, 2, 3]),
  setting("logLevel", "string", "General", "Minimum severity of log messages written to the output channel.", "Info", ["Debug", "Info", "Warning", "Error"]),
  setting("statusBarItem.dirtyIndicator", "string", "Status Bar", "How uncommitted changes are indicated on the status bar item.", "+N -M", ["+N -M", "*", "none"]),
  setting("branchPanel.groupsFirst", "boolean", "Branches", "Lists branch groups before individual branches in the branches panel.", true),
  setting("branchPanel.flattenSingleChildGroups", "boolean", "Branches", "Collapses a branch group that contains only one branch into that branch.", true),
  setting("dialog.repoInProgress.confirmAbort", "boolean", "General", "Asks for confirmation before aborting an in-progress Git operation (merge, rebase, etc.).", true),
  setting("uiDensity", "string", "General", "Overall spacing and sizing of the interface.", "Normal", ["Big", "Normal", "Compact"]),
  setting("repository.commits.columnVisibility", "columns", "Commits Table", "Which optional columns (Committed, ID) are shown in the commits table.", { Committed: true, ID: true }),
  setting("keyboardShortcut.refresh", "string", "General", "Keyboard shortcut that refreshes the commit graph.", "CTRL/CMD + R", shortcutOptions),
];

export type DisplayMode = "system" | "light" | "dark";
/** Hour cycle for the compact commit-time display. "system" reads the OS/browser locale. */
export type TimeFormat = "system" | "12h" | "24h";

export type AppSettings = Readonly<Record<string, unknown>> & {
  readonly mode: DisplayMode;
  readonly lightTheme: string;
  readonly darkTheme: string;
  readonly timeFormat: TimeFormat;
  /** Manifest URL checked for a newer version at boot; empty disables self-update. */
  readonly updateManifestUrl: string;
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
  updateManifestUrl: "",
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
      updateManifestUrl: typeof value.app.updateManifestUrl === "string" ? value.app.updateManifestUrl : "",
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
