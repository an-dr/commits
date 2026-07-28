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

export type RequestMessage = EchoRequest | PageReadyRequest;
export type ResponseMessage = CoreReadyResponse | EchoResponse;

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (!isRecord(value) || typeof value.command !== "string") {
    return false;
  }
  if (value.command === "pageReady") {
    return true;
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

