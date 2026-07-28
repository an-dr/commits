const STATE_KEY = "commits.vscodeApi.state";
let memoryState: unknown = null;

export interface VsCodeApi<TMessage, TState> {
  getState(): TState | null;
  postMessage(message: TMessage): void;
  setState(state: TState): void;
}

declare global {
  interface Window {
    acquireVsCodeApi<TMessage = unknown, TState = unknown>(): VsCodeApi<
      TMessage,
      TState
    >;
    ipc: { postMessage(message: string): void };
  }
}

/** Installs the VS Code-compatible facade over bones page IPC. */
export function installVsCodeApiShim(): void {
  let acquired = false;
  window.acquireVsCodeApi = <TMessage, TState>(): VsCodeApi<
    TMessage,
    TState
  > => {
    if (acquired) {
      throw new Error("An instance of the VS Code API has already been acquired");
    }
    acquired = true;
    return {
      getState: () => readState<TState>(),
      postMessage: (message) => window.ipc.postMessage(JSON.stringify(message)),
      setState: (state) => writeState(state),
    };
  };

  window.addEventListener("bones-message", (event) => {
    const json = (event as CustomEvent<string>).detail;
    try {
      window.dispatchEvent(
        new MessageEvent("message", { data: JSON.parse(json) }),
      );
    } catch {
      console.warn("Ignored malformed bones page message");
    }
  });
}

function readState<TState>(): TState | null {
  let json: string | null;
  try {
    json = localStorage.getItem(STATE_KEY);
  } catch {
    return memoryState as TState | null;
  }
  if (json === null) {
    return null;
  }
  try {
    return JSON.parse(json) as TState;
  } catch {
    try {
      localStorage.removeItem(STATE_KEY);
    } catch {}
    return null;
  }
}

function writeState<TState>(state: TState): void {
  memoryState = state;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Navigate-to-string pages may not receive a persistent storage origin.
  }
}
