import { Reader, Writer } from "./codec";

export type PanelSource =
  | { readonly kind: "html"; readonly value: string }
  | { readonly kind: "url"; readonly value: string };

export interface PageMessage {
  readonly owner: string;
  readonly panel: string;
  readonly json: string;
}

export interface PanelLifecycle {
  readonly owner: string;
  readonly panel: string;
}

export interface PanelFailed extends PanelLifecycle {
  readonly reason: string;
}

export function encodeOpenPanel(
  panel: string,
  source: PanelSource,
): Uint8Array {
  return new Writer()
    .u8(0)
    .string(panel)
    .u8(source.kind === "html" ? 0 : 1)
    .raw(new TextEncoder().encode(source.value))
    .finish();
}

export function encodeClosePanel(panel: string): Uint8Array {
  return new Writer().u8(1).raw(new TextEncoder().encode(panel)).finish();
}

export function encodeNavigate(panel: string, url: string): Uint8Array {
  return new Writer()
    .u8(2)
    .string(panel)
    .raw(new TextEncoder().encode(url))
    .finish();
}

export function encodeSendJson(panel: string, json: string): Uint8Array {
  return new Writer()
    .u8(3)
    .string(panel)
    .raw(new TextEncoder().encode(json))
    .finish();
}

export function decodePageMessage(payload: Uint8Array): PageMessage {
  const reader = new Reader(payload);
  return {
    owner: reader.string(),
    panel: reader.string(),
    json: reader.stringRest(),
  };
}

export function decodePanelOpened(payload: Uint8Array): PanelLifecycle {
  return decodeLifecycle(payload);
}

export function decodePanelClosed(payload: Uint8Array): PanelLifecycle {
  return decodeLifecycle(payload);
}

export function decodePanelFailed(payload: Uint8Array): PanelFailed {
  const reader = new Reader(payload);
  return {
    owner: reader.string(),
    panel: reader.string(),
    reason: reader.stringRest(),
  };
}

function decodeLifecycle(payload: Uint8Array): PanelLifecycle {
  const reader = new Reader(payload);
  return {
    owner: reader.string(),
    panel: reader.stringRest(),
  };
}

