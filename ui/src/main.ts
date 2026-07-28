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

api.postMessage({ command: "pageReady" });

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id}`);
  }
  return element as T;
}

