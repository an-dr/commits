import type { RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";

import "@an-dr/commits-webview-shell/assets/main.css";
import "@an-dr/commits-webview-shell/assets/dropdown.css";
import { createLocalizedStrings } from "@an-dr/commits-webview-shell/l10n";
import { buildGraphShell } from "@an-dr/commits-webview-shell/shell";
import { DEFAULT_SETTINGS, type SettingsDocument } from "@commits/adapter/read/settings";
import "./standalone-theme.css";
import { createViewState } from "./settings";
import { SettingsEditor } from "./settings-editor";
import { createAppearanceController } from "./themes";

const STATE_KEY = "commits.mit-webview.state";

type StandaloneMessage =
  | {
      command:
        | "standaloneReady"
        | "standaloneViewReady"
        | "standaloneChooseRepository"
        | "standaloneCloneCommitsRepo"
        | "standaloneOpenCommitsRepo"
        | "standaloneOpenCommitsRepoFolder";
    }
  | { command: "standaloneOpenRepository"; path: string }
  | { command: "standaloneSaveSettings"; requestId: number; settings: SettingsDocument };

interface StandaloneResponse {
  command:
    | "standaloneRepositoryRequired"
    | "standaloneSettings"
    | "standaloneSettingsSaved"
    | "standaloneCommitsRepoStatus";
  recent?: readonly string[];
  settings?: SettingsDocument;
  error?: string;
  requestId?: number;
  exists?: boolean;
  message?: string;
}

declare global {
  interface Window {
    ipc: { postMessage(message: string): void };
  }
}

void boot();

async function boot(): Promise<void> {
  const translate = (message: string) => message;
  globalThis.l10n = createLocalizedStrings(translate);
  document.body.innerHTML =
    `${menuBarHtml()}${buildGraphShell(translate)}${repositoryOverlayHtml()}`;

  let settingsSettled = false;
  let resolveSettings = (_settings: SettingsDocument): void => undefined;
  const settingsReady = new Promise<SettingsDocument>((resolve) => { resolveSettings = resolve; });
  const finishSettings = (settings: SettingsDocument): void => {
    if (settingsSettled) return;
    settingsSettled = true;
    window.clearTimeout(settingsTimeout);
    const button = document.getElementById("standaloneSettingsButton") as HTMLButtonElement | null;
    if (button !== null) button.disabled = false;
    resolveSettings(settings);
  };
  const settingsTimeout = window.setTimeout(() => finishSettings(DEFAULT_SETTINGS), 2_000);
  let activeSettings = DEFAULT_SETTINGS;
  let loadSettingsError = "";
  let nextSettingsRequestId = 1;
  let settingsEditor: SettingsEditor;
  const appearance = createAppearanceController();

  window.addEventListener("bones-message", (event) => {
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail) as ResponseMessage | StandaloneResponse;
      if (data.command === "standaloneRepositoryRequired") {
        renderRecentRepositories(data.recent ?? []);
        showRepositoryOverlay();
      } else if (data.command === "loadRepos" && Object.keys(data.repos).length > 0) {
        hideRepositoryOverlay();
      } else if (data.command === "standaloneSettings") {
        activeSettings = data.settings ?? DEFAULT_SETTINGS;
        loadSettingsError = data.error ?? "";
        finishSettings(activeSettings);
      } else if (data.command === "standaloneSettingsSaved") {
        activeSettings = data.settings ?? activeSettings;
        if (!data.error) appearance.update(activeSettings);
        settingsEditor.finishSave(activeSettings, data.error ?? "");
      } else if (data.command === "standaloneCommitsRepoStatus") {
        updateCommitsRepoStatus(data.exists === true, data.message ?? "");
      }
      window.dispatchEvent(new MessageEvent("message", { data }));
    } catch {
      console.warn("Ignored malformed Bones page message");
    }
  });

  wireMenuBar();
  wireRepositoryOverlay();
  settingsEditor = new SettingsEditor((settings) => {
    post({ command: "standaloneSaveSettings", requestId: nextSettingsRequestId++, settings });
  });
  document.getElementById("standaloneSettingsButton")!.addEventListener("click", () => {
    settingsEditor.open(activeSettings, loadSettingsError);
  });

  // Request settings before the shared view reads its global view state.
  post({ command: "standaloneReady" });
  const initialSettings = await settingsReady;
  appearance.update(initialSettings);
  globalThis.viewState = createViewState(initialSettings);
  // The shared graph reads viewState while its module is evaluated, so these
  // imports must not begin until the settings-backed global exists.
  const [{ setWebviewHost }, { startCommitsView }] = await Promise.all([
    import("@an-dr/commits-core/webview/utils/host"),
    import("@an-dr/commits-core/webview/main"),
  ]);
  setWebviewHost({
    postMessage: (message: RequestMessage) => post(message),
    getState: () => readState(),
    setState: (state) => writeState(state),
    getStyleValue: (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
  });
  startCommitsView();
  post({ command: "standaloneViewReady" });
}

function menuBarHtml(): string {
  return `<nav id="standaloneMenuBar">
    <div class="standaloneMenu">
      <button type="button" class="standaloneMenuTitle" aria-haspopup="true" aria-expanded="false">File</button>
      <ul class="standaloneMenuList" hidden>
        <li><button type="button" id="standaloneMenuOpenRepo">Open repo&hellip;</button></li>
        <li class="standaloneMenuSeparator" role="separator"></li>
        <li><button type="button" id="standaloneMenuCloneCommitsRepo">Clone Commits Repo</button></li>
        <li><button type="button" id="standaloneMenuOpenCommitsRepo" disabled>Open Commits Repo</button></li>
        <li><button type="button" id="standaloneMenuOpenCommitsRepoFolder" disabled>Open Commits Repo Folder</button></li>
      </ul>
    </div>
    <span id="standaloneMenuStatus" aria-live="polite"></span>
    <button type="button" id="standaloneSettingsButton" disabled>Settings</button>
  </nav>`;
}

/**
 * Drives the menu bar: one open menu at a time, closing on selection, on a
 * click elsewhere, or on Escape.
 */
function wireMenuBar(): void {
  const bar = document.getElementById("standaloneMenuBar")!;
  const title = bar.querySelector<HTMLButtonElement>(".standaloneMenuTitle")!;
  const list = bar.querySelector<HTMLUListElement>(".standaloneMenuList")!;

  const setOpen = (open: boolean): void => {
    list.hidden = !open;
    title.setAttribute("aria-expanded", String(open));
  };

  title.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(list.hidden);
  });
  document.getElementById("standaloneMenuOpenRepo")!.addEventListener("click", () => {
    setOpen(false);
    showRepositoryOverlay();
  });
  document.getElementById("standaloneMenuCloneCommitsRepo")!.addEventListener("click", () => {
    setOpen(false);
    post({ command: "standaloneCloneCommitsRepo" });
  });
  document.getElementById("standaloneMenuOpenCommitsRepo")!.addEventListener("click", () => {
    setOpen(false);
    post({ command: "standaloneOpenCommitsRepo" });
  });
  document.getElementById("standaloneMenuOpenCommitsRepoFolder")!.addEventListener("click", () => {
    setOpen(false);
    post({ command: "standaloneOpenCommitsRepoFolder" });
  });
  document.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}

/**
 * Enables Open Commits Repo / Open Commits Repo Folder once the clone
 * exists, and shows transient feedback about the last clone/open/reveal
 * outcome. The message clears itself so a stale "Cloning…" never lingers.
 */
let commitsRepoStatusTimer: number | null = null;
function updateCommitsRepoStatus(exists: boolean, message: string): void {
  const openButton = document.getElementById("standaloneMenuOpenCommitsRepo") as HTMLButtonElement | null;
  const folderButton = document.getElementById("standaloneMenuOpenCommitsRepoFolder") as HTMLButtonElement | null;
  if (openButton) openButton.disabled = !exists;
  if (folderButton) folderButton.disabled = !exists;

  const status = document.getElementById("standaloneMenuStatus");
  if (!status) return;
  status.textContent = message;
  if (commitsRepoStatusTimer !== null) window.clearTimeout(commitsRepoStatusTimer);
  commitsRepoStatusTimer = message
    ? window.setTimeout(() => { status.textContent = ""; }, 6_000)
    : null;
}

function repositoryOverlayHtml(): string {
  return `<div id="standaloneRepoOverlay" hidden>
    <form id="standaloneRepoForm">
      <h1>Open a Git repository</h1>
      <div id="standaloneRepoControls">
        <input id="standaloneRepoPath" placeholder="C:/path/to/repository" autocomplete="off">
        <button id="standaloneChooseRepo" type="button">Choose…</button>
        <button type="submit">Open</button>
      </div>
      <h2 id="standaloneRecentTitle">Recent</h2>
      <ul id="standaloneRecentRepos" hidden></ul>
    </form>
  </div>`;
}

function wireRepositoryOverlay(): void {
  const form = document.getElementById("standaloneRepoForm") as HTMLFormElement;
  const input = document.getElementById("standaloneRepoPath") as HTMLInputElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const path = input.value.trim();
    if (path) post({ command: "standaloneOpenRepository", path });
  });
  document.getElementById("standaloneChooseRepo")!.addEventListener("click", () => {
    post({ command: "standaloneChooseRepository" });
  });
}

/**
 * Lists previously opened repositories as one-click entries.
 *
 * Paths are inserted as text rather than markup, since a repository path is
 * arbitrary user input that reaches this list from persisted state.
 */
function renderRecentRepositories(recent: readonly string[]): void {
  const list = document.getElementById("standaloneRecentRepos")!;
  list.replaceChildren();
  list.hidden = recent.length === 0;
  document.getElementById("standaloneRecentTitle")!.hidden = recent.length === 0;
  for (const path of recent) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "standaloneRecentRepo";
    button.textContent = path;
    button.title = path;
    button.addEventListener("click", () => post({ command: "standaloneOpenRepository", path }));
    item.append(button);
    list.append(item);
  }
}

function showRepositoryOverlay(): void {
  document.getElementById("standaloneRepoOverlay")!.hidden = false;
}

function hideRepositoryOverlay(): void {
  document.getElementById("standaloneRepoOverlay")!.hidden = true;
}

function post(message: RequestMessage | StandaloneMessage): void {
  window.ipc.postMessage(JSON.stringify(message));
}

function readState(): WebViewState | null {
  try {
    const value = localStorage.getItem(STATE_KEY);
    return value === null ? null : (JSON.parse(value) as WebViewState);
  } catch {
    return null;
  }
}

function writeState(state: WebViewState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // The embedded page may be hosted at an origin without persistent storage.
  }
}
