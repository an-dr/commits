import type { SettingsDocument } from "@commits/adapter/read/settings";

export type ThemeMode = "light" | "dark";

export interface ThemeColours {
  readonly canvas: string;
  readonly surface: string;
  readonly elevated: string;
  readonly text: string;
  readonly border: string;
  readonly input: string;
  readonly hover: string;
  readonly selection: string;
  readonly selectionText: string;
  readonly accent: string;
  readonly positive: string;
  readonly negative: string;
  readonly warning: string;
  readonly shadow: string;
  readonly urgencyAdvisory: string;
  readonly urgencyCaution: string;
  readonly urgencyWarning: string;
}

/** Code colours for the full-diff panel, one per `--syntax-*` property in THEME.md. */
export interface SyntaxColours {
  readonly keyword: string;
  readonly string: string;
  readonly comment: string;
  readonly number: string;
  readonly function: string;
  readonly type: string;
  readonly variable: string;
  readonly constant: string;
  readonly meta: string;
  readonly tag: string;
}

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  readonly mode: ThemeMode;
  readonly colours: ThemeColours;
  readonly syntax: SyntaxColours;
}

export const LIGHT_THEMES: readonly ThemePreset[] = [
  preset("paper", "Paper", "light", ["#f3f3f3", "#eeeeee", "#ffffff", "#24292f", "#c8c8c8", "#ffffff", "#e8e8e8", "#d7e7ff", "#111111", "#007fd4", "#1a7f37", "#cf222e", "#9a6700", "rgba(0,0,0,.25)"],
    ["#0000ff", "#a31515", "#008000", "#098658", "#795e26", "#267f99", "#001080", "#0070c1", "#af00db", "#800000"]),
  preset("solarized-light", "Solarized Light", "light", ["#fdf6e3", "#eee8d5", "#fffaf0", "#586e75", "#d4cbb7", "#fffaf0", "#e8dfca", "#d5e5e8", "#073642", "#268bd2", "#859900", "#dc322f", "#b58900", "rgba(7,54,66,.22)"],
    ["#738a00", "#1f8a82", "#7c8b8b", "#d33682", "#268bd2", "#9c7600", "#6c71c4", "#cb4b16", "#dc322f", "#268bd2"]),
  preset("high-contrast-light", "High Contrast Light", "light", ["#ffffff", "#ffffff", "#ffffff", "#000000", "#000000", "#ffffff", "#e5e5e5", "#000000", "#ffffff", "#005fb8", "#006b1b", "#b00020", "#725c00", "rgba(0,0,0,.35)"],
    ["#0000c0", "#a31515", "#515151", "#096d48", "#5e2cbc", "#185e73", "#001080", "#7a3e00", "#9a0070", "#800000"]),
];

export const DARK_THEMES: readonly ThemePreset[] = [
  preset("graphite", "Graphite", "dark", ["#1e1e1e", "#181818", "#252526", "#d4d4d4", "#454545", "#313131", "#2a2d2e", "#04395e", "#ffffff", "#007fd4", "#89d185", "#f14c4c", "#cca700", "rgba(0,0,0,.55)"],
    ["#569cd6", "#ce9178", "#6a9955", "#b5cea8", "#dcdcaa", "#4ec9b0", "#9cdcfe", "#4fc1ff", "#c586c0", "#569cd6"]),
  preset("midnight", "Midnight", "dark", ["#0d1117", "#010409", "#161b22", "#c9d1d9", "#30363d", "#0d1117", "#21262d", "#1f6feb", "#ffffff", "#58a6ff", "#3fb950", "#f85149", "#d29922", "rgba(0,0,0,.7)"],
    ["#ff7b72", "#a5d6ff", "#8b949e", "#79c0ff", "#d2a8ff", "#ffa657", "#e3b341", "#79c0ff", "#ff7b72", "#7ee787"]),
  preset("high-contrast-dark", "High Contrast Dark", "dark", ["#000000", "#000000", "#000000", "#ffffff", "#ffffff", "#000000", "#333333", "#ffffff", "#000000", "#00aaff", "#7fff7f", "#ff6b6b", "#ffff00", "rgba(255,255,255,.28)"],
    ["#6fc3ff", "#ffa07a", "#8fd18f", "#d7f5b0", "#ffff9e", "#5ff5d5", "#b3e6ff", "#7fd8ff", "#ff9eff", "#6fc3ff"]),
];

/** Resolves system mode and independently stored light/dark selections. */
export interface ThemeFile { readonly version: 1; readonly name: string; readonly light: ThemePreset; readonly dark: ThemePreset }
export interface SessionAppearance { mode?: ThemeMode; file?: ThemeFile }

export function resolveAppearance(settings: SettingsDocument, systemDark: boolean, session: SessionAppearance = {}): ThemePreset {
  const mode = session.mode ?? (settings.app.mode === "system" ? (systemDark ? "dark" : "light") : settings.app.mode);
  if (session.file) return session.file[mode];
  const themes = mode === "dark" ? DARK_THEMES : LIGHT_THEMES;
  const selected = mode === "dark" ? settings.app.darkTheme : settings.app.lightTheme;
  return themes.find(({ id }) => id === selected) ?? themes[0];
}

/** Keeps the active palette synchronized with settings and operating-system mode. */
export function createAppearanceController(): { update(settings: SettingsDocument): void; override(session: SessionAppearance): void } {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  let settings: SettingsDocument | null = null;
  let session: SessionAppearance = {};
  const apply = (): void => {
    if (settings === null) return;
    applyTheme(resolveAppearance(settings, query.matches, session));
  };
  query.addEventListener("change", apply);
  return {
    update(value) { if (settings && settings.app.mode !== value.app.mode) session.mode = undefined; settings = value; apply(); },
    override(value) { session = { ...session, ...value }; apply(); },
  };
}

function applyTheme(theme: ThemePreset): void {
  const { colours } = theme;
  document.body.classList.toggle("vscode-dark", theme.mode === "dark");
  document.body.classList.toggle("vscode-light", theme.mode === "light");
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.mode;
  const variables: Record<string, string> = {
    "--vscode-editor-background": colours.canvas,
    "--vscode-editor-foreground": colours.text,
    "--vscode-foreground": colours.text,
    "--vscode-sideBar-background": colours.surface,
    "--vscode-editorWidget-background": colours.elevated,
    "--vscode-menu-background": colours.elevated,
    "--vscode-menu-foreground": colours.text,
    "--vscode-input-background": colours.input,
    "--vscode-input-foreground": colours.text,
    "--vscode-input-border": colours.border,
    "--vscode-widget-border": colours.border,
    "--vscode-menu-separatorBackground": colours.border,
    "--vscode-list-hoverBackground": colours.hover,
    "--vscode-toolbar-hoverBackground": colours.hover,
    "--vscode-list-activeSelectionBackground": colours.selection,
    "--vscode-list-dropBackground": colours.selection,
    "--vscode-list-inactiveSelectionBackground": colours.hover,
    "--vscode-menu-selectionBackground": colours.selection,
    "--vscode-menu-selectionForeground": colours.selectionText,
    "--vscode-focusBorder": colours.accent,
    "--vscode-button-background": colours.accent,
    "--vscode-gitDecoration-addedResourceForeground": colours.positive,
    "--vscode-gitDecoration-deletedResourceForeground": colours.negative,
    "--vscode-gitDecoration-modifiedResourceForeground": colours.warning,
    // The banners and the repo selector's submodule markers read as warnings
    // and errors, so they follow the theme's own two colours for those rather
    // than a hard-coded amber that goes muddy on half the presets.
    "--vscode-editorWarning-foreground": colours.warning,
    "--vscode-editorError-foreground": colours.negative,
    "--vscode-gitDecoration-untrackedResourceForeground": colours.positive,
    "--vscode-widget-shadow": colours.shadow,
    "--urgency-advisory": colours.urgencyAdvisory,
    "--urgency-caution": colours.urgencyCaution,
    "--urgency-warning": colours.urgencyWarning,
  };
  for (const [token, value] of Object.entries(theme.syntax)) variables[`--syntax-${token}`] = value;
  for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value);
}

function preset(id: string, name: string, mode: ThemeMode, values: readonly string[], syntaxValues: readonly string[]): ThemePreset {
  const [canvas, surface, elevated, text, border, input, hover, selection, selectionText, accent, positive, negative, warning, shadow] = values;
  const [keyword, string, comment, number, fn, type, variable, constant, meta, tag] = syntaxValues;
  return {
    id, name, mode,
    colours: { canvas, surface, elevated, text, border, input, hover, selection, selectionText, accent, positive, negative, warning, shadow,
      urgencyAdvisory: mode === "light" ? "#a66a00" : "#e5ad45", urgencyCaution: mode === "light" ? "#bd421f" : "#fa845c", urgencyWarning: mode === "light" ? "#b62665" : "#ef7fac" },
    syntax: { keyword, string, comment, number, function: fn, type, variable, constant, meta, tag },
  };
}

function isColour(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return true;
  const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+)\s*\)$/.exec(value);
  return rgba !== null && rgba.slice(1, 4).every((channel) => Number(channel) <= 255);
}

/** Validates all required tokens, retaining only keys in the Commits contract. */
export function parseThemeFile(json: unknown): ThemeFile | Error {
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!record(json) || json.version !== 1 || typeof json.name !== "string") return new Error("expected version 1 and a name");
  const palettes: Partial<Record<ThemeMode, ThemePreset>> = {};
  for (const mode of ["light", "dark"] as const) {
    const input = json[mode];
    if (!record(input) || !record(input.colours)) return new Error(`${mode}.colours is required`);
    const base = (mode === "light" ? LIGHT_THEMES : DARK_THEMES)[0];
    const colours: Record<string, string> = {};
    for (const key of Object.keys(base.colours)) {
      if (!isColour(input.colours[key])) return new Error(`${mode}.colours.${key} is missing or invalid`);
      colours[key] = input.colours[key];
    }
    let syntax = base.syntax;
    if (input.syntax !== undefined) {
      if (!record(input.syntax)) return new Error(`${mode}.syntax must be an object`);
      const tokens: Record<string, string> = {};
      for (const key of Object.keys(base.syntax)) {
        if (!isColour(input.syntax[key])) return new Error(`${mode}.syntax.${key} is missing or invalid`);
        tokens[key] = input.syntax[key];
      }
      syntax = tokens as unknown as SyntaxColours;
    }
    palettes[mode] = { id: "session", name: json.name, mode, colours: colours as unknown as ThemeColours, syntax };
  }
  return { version: 1, name: json.name, light: palettes.light!, dark: palettes.dark! };
}
