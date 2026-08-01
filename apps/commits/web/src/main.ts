import type { GitGraphViewState, RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";

import "@an-dr/commits-webview-shell/assets/main.css";
import "@an-dr/commits-webview-shell/assets/dropdown.css";
import { createLocalizedStrings } from "@an-dr/commits-webview-shell/l10n";
import { buildGraphShell } from "@an-dr/commits-webview-shell/shell";
import "./standalone-theme.css";

const STATE_KEY = "commits.mit-webview.state";

interface StandaloneMessage {
  command: "standaloneReady" | "standaloneChooseRepository" | "standaloneOpenRepository";
  path?: string;
}

interface StandaloneResponse {
  command: "standaloneRepositoryRequired";
  recent?: readonly string[];
}

declare global {
  interface Window {
    ipc: { postMessage(message: string): void };
  }
}

void boot();

async function boot(): Promise<void> {
  const translate = (message: string) => message;
  globalThis.viewState = defaultViewState();
  globalThis.l10n = createLocalizedStrings(translate);
  document.body.innerHTML =
    `${menuBarHtml()}${buildGraphShell(translate)}${repositoryOverlayHtml()}`;

  window.addEventListener("bones-message", (event) => {
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail) as ResponseMessage | StandaloneResponse;
      if (data.command === "standaloneRepositoryRequired") {
        renderRecentRepositories(data.recent ?? []);
        showRepositoryOverlay();
      } else if (data.command === "loadRepos" && Object.keys(data.repos).length > 0) {
        hideRepositoryOverlay();
      }
      window.dispatchEvent(new MessageEvent("message", { data }));
    } catch {
      console.warn("Ignored malformed Bones page message");
    }
  });

  wireMenuBar();
  wireRepositoryOverlay();

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
  // Announce readiness before the shared view mounts, so the core has bootstrapped
  // by the time the view issues its first repository query.
  post({ command: "standaloneReady" });
  startCommitsView();
}

function menuBarHtml(): string {
  return `<nav id="standaloneMenuBar">
    <div class="standaloneMenu">
      <button type="button" class="standaloneMenuTitle" aria-haspopup="true" aria-expanded="false">File</button>
      <ul class="standaloneMenuList" hidden>
        <li><button type="button" id="standaloneMenuOpenRepo">Open repo&hellip;</button></li>
      </ul>
    </div>
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
  document.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
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

function defaultViewState(): GitGraphViewState {
  return {
    autoCenterCommitDetailsView: true,
    committedVisual: "Initials",
    avatarMode: "Disabled",
    avatarSize: "Small",
    avatarShape: "Circle",
    dateFormat: "Date & Time",
    fetchAvatars: false,
    fileIcons: {},
    uiDensity: "Compact",
    refreshShortcutKey: "r",
    branchPanelGroupsFirst: true,
    branchPanelFlattenSingleChildGroups: false,
    confirmAbortRepoInProgress: true,
    columnVisibility: { Committed: true, ID: true },
    graphColours: ["#0066ff", "#e51400", "#16a34a", "#9333ea", "#ea580c", "#0891b2"],
    graphStyle: "rounded",
    initialLoadCommits: 300,
    lastActiveRepo: null,
    loadMoreCommits: 100,
    locale: navigator.language || "en",
    repos: {},
    showCurrentBranchByDefault: false,
  };
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
