export interface EchoRequest {
  readonly command: "echo";
  readonly requestId: number;
  readonly value: string;
}

export interface EchoResponse {
  readonly command: "echo";
  readonly requestId: number;
  readonly value: string;
  readonly receivedAt: string;
}

export interface PageReadyRequest {
  readonly command: "pageReady";
}

export interface CoreReadyResponse {
  readonly command: "coreReady";
  readonly runtime: "bones";
}

export interface OsCapabilityRequest {
  readonly command: "osCapability";
  readonly requestId: number;
  readonly action: import("../../proto/ts/native").OsAction;
  readonly value?: string;
}

export interface OsCapabilityResponse {
  readonly command: "osCapability";
  readonly requestId: number;
  readonly accepted: boolean;
  readonly value: string;
  readonly error: string;
}

export type RequestMessage = EchoRequest | PageReadyRequest | OsCapabilityRequest;
export type ResponseMessage = CoreReadyResponse | EchoResponse | OsCapabilityResponse;

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (!isRecord(value) || typeof value.command !== "string") {
    return false;
  }
  if (value.command === "pageReady") {
    return true;
  }
  if (value.command === "osCapability") {
    return Number.isSafeInteger(value.requestId)
      && ["clipboard-read", "clipboard-write", "open-url", "pick-file", "pick-folder"]
        .includes(String(value.action))
      && (value.value === undefined || typeof value.value === "string");
  }
  return (
    value.command === "echo" &&
    Number.isSafeInteger(value.requestId) &&
    typeof value.value === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

