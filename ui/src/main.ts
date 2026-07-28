import type { RequestMessage, ResponseMessage } from "../../core/src/protocol";
import { installVsCodeApiShim } from "./vscode-api";

interface PageState {
  readonly nextRequestId: number;
}

installVsCodeApiShim();
const api = window.acquireVsCodeApi<RequestMessage, PageState>();
let nextRequestId = api.getState()?.nextRequestId ?? 1;

const form = requiredElement<HTMLFormElement>("echo-form");
const input = requiredElement<HTMLInputElement>("echo-value");
const history = requiredElement<HTMLOListElement>("history");
const status = requiredElement<HTMLParagraphElement>("status");
const nativeResult = requiredElement<HTMLParagraphElement>("native-result");

window.addEventListener("message", (event: MessageEvent<ResponseMessage>) => {
  if (event.data.command === "coreReady") {
    status.textContent = "Connected · bones host · TypeScript WASM core";
    return;
  }
  if (event.data.command === "echo") {
    const item = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = `#${event.data.requestId}`;
    item.append(time, event.data.value);
    history.prepend(item);
    return;
  }
  if (event.data.command === "osCapability") {
    nativeResult.textContent = event.data.error || event.data.value
      || (event.data.accepted ? "Completed" : "Cancelled");
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  api.postMessage({
    command: "echo",
    requestId: nextRequestId,
    value: input.value,
  });
  nextRequestId += 1;
  api.setState({ nextRequestId });
});

document.querySelectorAll<HTMLButtonElement>("[data-os-action]").forEach((button) => {
  button.addEventListener("click", () => {
    api.postMessage({
      command: "osCapability",
      requestId: nextRequestId++,
      action: button.dataset.osAction as "clipboard-read" | "pick-file" | "pick-folder",
    });
    api.setState({ nextRequestId });
  });
});

api.postMessage({ command: "pageReady" });

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id}`);
  }
  return element as T;
}

