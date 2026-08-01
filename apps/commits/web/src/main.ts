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
  document.body.innerHTML = `${buildGraphShell(translate)}${repositoryOverlayHtml()}`;

  window.addEventListener("bones-message", (event) => {
    try {
      const data = JSON.parse((event as CustomEvent<string>).detail) as ResponseMessage | StandaloneResponse;
      if (data.command === "standaloneRepositoryRequired") {
        showRepositoryOverlay();
      } else if (data.command === "loadRepos" && Object.keys(data.repos).length > 0) {
        hideRepositoryOverlay();
      }
      window.dispatchEvent(new MessageEvent("message", { data }));
    } catch {
      console.warn("Ignored malformed Bones page message");
    }
  });

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
  startCommitsView();
  post({ command: "standaloneReady" });
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
