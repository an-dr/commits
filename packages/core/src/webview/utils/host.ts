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

type SentMessageListener = (message: RequestMessage) => void;

let sentListener: SentMessageListener | null = null;

/**
 * Watches every request the view sends, wherever it is sent from. One listener
 * only: the single caller is the toolbar's activity light, and a list would
 * invite work here that belongs on the receiving end.
 */
export function observeMessagesSent(listener: SentMessageListener) {
  sentListener = listener;
}

export function sendMessage(msg: RequestMessage) {
  sentListener?.(msg);
  host().postMessage(msg);
}

export function getVSCodeStyle(name: string) {
  return host().getStyleValue(name);
}
