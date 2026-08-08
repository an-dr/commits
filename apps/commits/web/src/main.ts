import type { RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";

import "@an-dr/commits-webview-shell/assets/main.css";
import "@an-dr/commits-webview-shell/assets/dropdown.css";
import { createLocalizedStrings } from "@an-dr/commits-webview-shell/l10n";
import { buildGraphShell } from "@an-dr/commits-webview-shell/shell";
import { DEFAULT_SETTINGS, type SettingsDocument } from "@commits/adapter/read/settings";
import { toolbarIcons } from "@an-dr/commits-core/webview/utils/icons";
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
        | "standaloneOpenCommitsRepoFolder"
        | "standaloneStartUpdate"
        | "standaloneInstall";
    }
  | { command: "standaloneOpenRepository"; path: string }
  | { command: "standaloneSaveSettings"; requestId: number; settings: SettingsDocument };

interface StandaloneResponse {
  command:
    | "standaloneRepositoryRequired"
    | "standaloneSettings"
    | "standaloneSettingsSaved"
    | "standaloneCommitsRepoStatus"
    | "standaloneUpdateStatus"
    | "standaloneInstallStatus";
  recent?: readonly string[];
  settings?: SettingsDocument;
  error?: string;
  requestId?: number;
  exists?: boolean;
  message?: string;
  available?: boolean;
  version?: string;
  ready?: boolean;
  status?: "hidden" | "ready" | "staged" | "done";
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
    `${buildGraphShell(translate)}${repositoryOverlayHtml()}`;
  document.getElementById("appMenuSlot")!.innerHTML = appMenuHtml();

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
      } else if (data.command === "standaloneUpdateStatus") {
        updateUpdateStatus(data.available === true, data.version ?? "", data.ready === true, data.message ?? "");
      } else if (data.command === "standaloneInstallStatus") {
        updateInstallStatus(data.status ?? "hidden", data.version ?? "", data.message ?? "");
      }
      window.dispatchEvent(new MessageEvent("message", { data }));
    } catch {
      console.warn("Ignored malformed Bones page message");
    }
  });

  wireAppMenu();
  wireRepositoryOverlay();
  settingsEditor = new SettingsEditor(
    (settings) => {
      post({ command: "standaloneSaveSettings", requestId: nextSettingsRequestId++, settings });
    },
    (key) => {
      post({ command: "copyToClipboard", type: "settingsKey", data: key });
    },
  );
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

function appMenuHtml(): string {
  return `<div id="standaloneMenuWrap">
    <div class="standaloneMenu">
      <button type="button" id="standaloneMenuButton" class="iconBtn" aria-haspopup="true" aria-expanded="false" title="Menu">${toolbarIcons.menu}</button>
      <ul class="standaloneMenuList" hidden>
        <li><button type="button" id="standaloneMenuOpenRepo">Open&hellip;</button></li>
        <li class="standaloneMenuSeparator" role="separator"></li>
        <li><button type="button" id="standaloneSettingsButton" disabled>Settings</button></li>
        <li class="standaloneMenuGroup">
          <button type="button" class="standaloneMenuTitle" aria-haspopup="true">
            <span>About</span>
            <span class="standaloneMenuChevron" aria-hidden="true">&rsaquo;</span>
          </button>
          <ul class="standaloneMenuSubList">
            <li class="standaloneMenuVersion" id="standaloneMenuVersion"></li>
            <li class="standaloneMenuVersion">Dev: an-dr, 2026</li>
            <li><a href="https://github.com/an-dr/commits" id="standaloneMenuRepoLink" class="standaloneMenuLink">Repo: github.com/an-dr/commits</a></li>
            <li class="standaloneMenuSeparator" role="separator"></li>
            <li><button type="button" id="standaloneMenuCloneCommitsRepo">Clone Commits Repo</button></li>
            <li><button type="button" id="standaloneMenuOpenCommitsRepo" disabled>Open Commits Repo</button></li>
            <li><button type="button" id="standaloneMenuOpenCommitsRepoFolder" disabled>Open Commits Repo Folder</button></li>
            <li class="standaloneMenuSeparator" role="separator"></li>
            <li><button type="button" id="standaloneMenuInstall" hidden>Install</button></li>
            <li><button type="button" id="standaloneMenuUpdate" hidden></button></li>
          </ul>
        </li>
      </ul>
    </div>
    <span id="standaloneMenuStatus" aria-live="polite"></span>
  </div>`;
}

/**
 * Drives the menu: the top-level button opens Open/Settings/About; About's
 * own items fly out on hover (or focus, for keyboard use) via CSS alone.
 * Everything closes on selection, a click elsewhere, or Escape.
 */
function wireAppMenu(): void {
  const wrap = document.getElementById("standaloneMenuWrap")!;
  const menuButton = document.getElementById("standaloneMenuButton") as HTMLButtonElement;
  const list = wrap.querySelector<HTMLUListElement>(".standaloneMenuList")!;

  const setMenuOpen = (open: boolean): void => {
    list.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  };

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenuOpen(list.hidden);
  });
  document.getElementById("standaloneMenuOpenRepo")!.addEventListener("click", () => {
    setMenuOpen(false);
    showRepositoryOverlay();
  });
  document.getElementById("standaloneMenuRepoLink")!.addEventListener("click", (event) => {
    event.preventDefault();
    setMenuOpen(false);
    post({ command: "openExternalUrl", url: "https://github.com/an-dr/commits" });
  });
  document.getElementById("standaloneMenuCloneCommitsRepo")!.addEventListener("click", () => {
    setMenuOpen(false);
    post({ command: "standaloneCloneCommitsRepo" });
  });
  document.getElementById("standaloneMenuOpenCommitsRepo")!.addEventListener("click", () => {
    setMenuOpen(false);
    post({ command: "standaloneOpenCommitsRepo" });
  });
  document.getElementById("standaloneMenuOpenCommitsRepoFolder")!.addEventListener("click", () => {
    setMenuOpen(false);
    post({ command: "standaloneOpenCommitsRepoFolder" });
  });
  document.getElementById("standaloneMenuUpdate")!.addEventListener("click", () => {
    setMenuOpen(false);
    post({ command: "standaloneStartUpdate" });
  });
  document.getElementById("standaloneMenuInstall")!.addEventListener("click", () => {
    setMenuOpen(false);
    post({ command: "standaloneInstall" });
  });
  document.addEventListener("click", () => setMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenuOpen(false);
  });
}

/**
 * Enables Open Commits Repo / Open Commits Repo Folder once the clone
 * exists, and shows transient feedback about the last clone/open/reveal
 * outcome. The message clears itself so a stale "Cloning…" never lingers.
 */
function updateCommitsRepoStatus(exists: boolean, message: string): void {
  const openButton = document.getElementById("standaloneMenuOpenCommitsRepo") as HTMLButtonElement | null;
  const folderButton = document.getElementById("standaloneMenuOpenCommitsRepoFolder") as HTMLButtonElement | null;
  if (openButton) openButton.disabled = !exists;
  if (folderButton) folderButton.disabled = !exists;
  showMenuStatus(message);
}

/**
 * Shows the Update entry once a check finds a newer version, and reports
 * transient feedback about a download in progress or its outcome. Once
 * `ready` (the download is staged), the label switches to prompting a
 * restart rather than offering to start the same download again.
 */
function updateUpdateStatus(available: boolean, version: string, ready: boolean, message: string): void {
  const button = document.getElementById("standaloneMenuUpdate") as HTMLButtonElement | null;
  if (button) {
    button.hidden = !available;
    button.textContent = ready ? "Restart to update" : `Update to ${version}`;
  }
  showMenuStatus(message);
}

/**
 * Shows the Install entry once boot determines this run is not the one
 * installed at the canonical location, and reports transient feedback about
 * an install attempt. `staged` (an existing launcher will apply this on its
 * next start) switches the label to prompting a restart, the same as the
 * Update entry once its download is staged. `done` (placed directly at the
 * install location -- nothing was installed there before, so nothing is
 * pending) hides the entry again: there is nothing further this run can do.
 */
function updateInstallStatus(status: "hidden" | "ready" | "staged" | "done", version: string, message: string): void {
  const button = document.getElementById("standaloneMenuInstall") as HTMLButtonElement | null;
  if (button) {
    button.hidden = status === "hidden" || status === "done";
    button.textContent = status === "staged" ? "Restart to install" : "Install";
  }
  const versionLabel = document.getElementById("standaloneMenuVersion");
  if (versionLabel && version) versionLabel.textContent = `Version ${version}`;
  showMenuStatus(message);
}

/** Transient feedback shared by the Commits Repo and Update menu actions. */
let menuStatusTimer: number | null = null;
function showMenuStatus(message: string): void {
  const status = document.getElementById("standaloneMenuStatus");
  if (!status) return;
  status.textContent = message;
  if (menuStatusTimer !== null) window.clearTimeout(menuStatusTimer);
  menuStatusTimer = message
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
