import type { RequestMessage, ResponseMessage } from "../../../core/src/protocol";
import { installVsCodeApiShim } from "../vscode-api";
import { RepositoryView } from "./repository-view";

interface PageState { readonly nextRequestId: number; readonly repository?: string; }

/** Starts the host-neutral page shell; feature panels live in ui/ modules. */
export function startPage(): void {
  installVsCodeApiShim();
  const api = window.acquireVsCodeApi<RequestMessage, PageState>();
  let nextRequestId = api.getState()?.nextRequestId ?? 1;
  const form = requiredElement<HTMLFormElement>("repository-form");
  const input = requiredElement<HTMLInputElement>("repository-path");
  const status = requiredElement<HTMLParagraphElement>("status");
  const view = new RepositoryView(requiredElement("branches"), requiredElement("commit-table"), requiredElement("commit-count"), requiredElement("errors"), requiredElement("commit-detail"), requiredElement("find"));
  input.value = api.getState()?.repository ?? "";

  window.addEventListener("message", (event: MessageEvent<ResponseMessage>) => {
    if (event.data.command === "coreReady") status.textContent = "Ready · choose a repository folder to read its local history";
    else if (event.data.command === "repositorySnapshot") {
      status.textContent = event.data.errors.length ? `Loaded ${event.data.repository} with warnings` : `Loaded ${event.data.repository}`;
      input.value = event.data.repository;
      view.render(event.data);
      save();
    } else if (event.data.command === "osCapability") {
      if (event.data.accepted && event.data.value) load(event.data.value);
      else if (event.data.error) status.textContent = event.data.error;
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    load(input.value);
  });
  requiredElement<HTMLButtonElement>("choose-repository").addEventListener("click", () => {
    api.postMessage({ command: "osCapability", requestId: nextRequestId++, action: "pick-folder" });
    save();
  });
  requiredElement<HTMLButtonElement>("refresh").addEventListener("click", () => api.postMessage({ command: "refreshRepository" }));
  window.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); requiredElement<HTMLInputElement>("find").focus(); } });
  api.postMessage({ command: "pageReady" });

  function load(path: string): void {
    const trimmed = path.trim();
    if (!trimmed) return;
    status.textContent = `Reading ${trimmed}…`;
    api.postMessage({ command: "loadRepository", path: trimmed });
    save();
  }
  function save(): void { api.setState({ nextRequestId, repository: input.value }); }
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}`);
  return element as T;
}
