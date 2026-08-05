import type { SettingsDocument } from "@commits/adapter/read/settings";

export type ThemeMode = "light" | "dark";

interface ThemeColours {
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
}

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  readonly mode: ThemeMode;
  readonly colours: ThemeColours;
}

export const LIGHT_THEMES: readonly ThemePreset[] = [
  preset("paper", "Paper", "light", ["#f3f3f3", "#eeeeee", "#ffffff", "#24292f", "#c8c8c8", "#ffffff", "#e8e8e8", "#d7e7ff", "#111111", "#007fd4", "#1a7f37", "#cf222e", "#9a6700", "rgba(0,0,0,.25)"]),
  preset("solarized-light", "Solarized Light", "light", ["#fdf6e3", "#eee8d5", "#fffaf0", "#586e75", "#d4cbb7", "#fffaf0", "#e8dfca", "#d5e5e8", "#073642", "#268bd2", "#859900", "#dc322f", "#b58900", "rgba(7,54,66,.22)"]),
  preset("high-contrast-light", "High Contrast Light", "light", ["#ffffff", "#ffffff", "#ffffff", "#000000", "#000000", "#ffffff", "#e5e5e5", "#000000", "#ffffff", "#005fb8", "#006b1b", "#b00020", "#725c00", "rgba(0,0,0,.35)"]),
];

export const DARK_THEMES: readonly ThemePreset[] = [
  preset("graphite", "Graphite", "dark", ["#1e1e1e", "#181818", "#252526", "#d4d4d4", "#454545", "#313131", "#2a2d2e", "#04395e", "#ffffff", "#007fd4", "#89d185", "#f14c4c", "#cca700", "rgba(0,0,0,.55)"]),
  preset("midnight", "Midnight", "dark", ["#0d1117", "#010409", "#161b22", "#c9d1d9", "#30363d", "#0d1117", "#21262d", "#1f6feb", "#ffffff", "#58a6ff", "#3fb950", "#f85149", "#d29922", "rgba(0,0,0,.7)"]),
  preset("high-contrast-dark", "High Contrast Dark", "dark", ["#000000", "#000000", "#000000", "#ffffff", "#ffffff", "#000000", "#333333", "#ffffff", "#000000", "#00aaff", "#7fff7f", "#ff6b6b", "#ffff00", "rgba(255,255,255,.28)"]),
];

/** Resolves system mode and independently stored light/dark selections. */
export function resolveAppearance(settings: SettingsDocument, systemDark: boolean): ThemePreset {
  const mode = settings.app.mode === "system" ? (systemDark ? "dark" : "light") : settings.app.mode;
  const themes = mode === "dark" ? DARK_THEMES : LIGHT_THEMES;
  const selected = mode === "dark" ? settings.app.darkTheme : settings.app.lightTheme;
  return themes.find(({ id }) => id === selected) ?? themes[0];
}

/** Keeps the active palette synchronized with settings and operating-system mode. */
export function createAppearanceController(): { update(settings: SettingsDocument): void } {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  let settings: SettingsDocument | null = null;
  const apply = (): void => {
    if (settings === null) return;
    applyTheme(resolveAppearance(settings, query.matches));
  };
  query.addEventListener("change", apply);
  return { update(value) { settings = value; apply(); } };
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
    "--vscode-list-inactiveSelectionBackground": colours.hover,
    "--vscode-menu-selectionBackground": colours.selection,
    "--vscode-menu-selectionForeground": colours.selectionText,
    "--vscode-focusBorder": colours.accent,
    "--vscode-button-background": colours.accent,
    "--vscode-gitDecoration-addedResourceForeground": colours.positive,
    "--vscode-gitDecoration-deletedResourceForeground": colours.negative,
    "--vscode-gitDecoration-modifiedResourceForeground": colours.warning,
    "--vscode-gitDecoration-untrackedResourceForeground": colours.positive,
    "--vscode-widget-shadow": colours.shadow,
  };
  for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value);
}

function preset(id: string, name: string, mode: ThemeMode, values: readonly string[]): ThemePreset {
  const [canvas, surface, elevated, text, border, input, hover, selection, selectionText, accent, positive, negative, warning, shadow] = values;
  return { id, name, mode, colours: { canvas, surface, elevated, text, border, input, hover, selection, selectionText, accent, positive, negative, warning, shadow } };
}
