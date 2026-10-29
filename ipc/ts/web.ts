import { WebSendSourceKind, WebSendTag, type WebPageMessage, type WebPanelFailed, type WebPanelOpened } from "./bones-messages";
import { Reader, Writer } from "./codec";

export type PanelSource =
  | { readonly kind: "html"; readonly value: string }
  | { readonly kind: "url"; readonly value: string };

export type PageMessage = WebPageMessage;
export type PanelLifecycle = WebPanelOpened;
export type PanelFailed = WebPanelFailed;

export function encodeOpenPanel(
  panel: string,
  source: PanelSource,
): Uint8Array {
  return new Writer()
    .u8(WebSendTag.open)
    .string(panel)
    .u8(source.kind === "html" ? WebSendSourceKind.inlineHtml : WebSendSourceKind.url)
    .raw(new TextEncoder().encode(source.value))
    .finish();
}

export function encodeClosePanel(panel: string): Uint8Array {
  return new Writer().u8(WebSendTag.close).raw(new TextEncoder().encode(panel)).finish();
}

export function encodeNavigate(panel: string, url: string): Uint8Array {
  return new Writer()
    .u8(WebSendTag.navigate)
    .string(panel)
    .raw(new TextEncoder().encode(url))
    .finish();
}

export function encodeSendJson(panel: string, json: string): Uint8Array {
  return new Writer()
    .u8(WebSendTag.sendJson)
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

