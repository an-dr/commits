import type { RequestMessage } from "@an-dr/commits-core/types";

/**
 * The webview's view of its host: a message channel, a place to persist view
 * state across reloads, and the theme values the stylesheet reads.
 *
 * VS Code satisfies this with `acquireVsCodeApi`; a standalone client can
 * satisfy it with any channel it likes.
 */
export interface WebviewHost {
  postMessage(message: RequestMessage): void;
  getState(): WebViewState | null;
  setState(state: WebViewState): void;
  /** Value of a CSS custom property, e.g. "--vscode-editor-font-family". */
  getStyleValue(name: string): string;
}

let current: WebviewHost | null = null;

/** Installs the host. Must be called before the view starts. */
export function setWebviewHost(next: WebviewHost) {
  current = next;
}

function host(): WebviewHost {
  if (current === null) {
    throw new Error("No webview host installed: call setWebviewHost first.");
  }
  return current;
}

export const vscode = {
  getState: () => host().getState(),
  setState: (state: WebViewState) => host().setState(state)
};

export function sendMessage(msg: RequestMessage) {
  host().postMessage(msg);
}

export function getVSCodeStyle(name: string) {
  return host().getStyleValue(name);
}
