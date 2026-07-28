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

export interface LoadRepositoryRequest {
  readonly command: "loadRepository";
  readonly path: string;
}

export interface RefreshRepositoryRequest {
  readonly command: "refreshRepository";
}

export interface RepositorySnapshotResponse {
  readonly command: "repositorySnapshot";
  readonly repository: string;
  readonly commits: readonly import("./read/models").Commit[];
  readonly refs: import("./read/models").RefSnapshot;
  readonly errors: readonly string[];
}

export type RequestMessage = EchoRequest | PageReadyRequest | OsCapabilityRequest | LoadRepositoryRequest | RefreshRepositoryRequest;
export type ResponseMessage = CoreReadyResponse | EchoResponse | OsCapabilityResponse | RepositorySnapshotResponse;

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
  if (value.command === "loadRepository") return typeof value.path === "string" && value.path.trim().length > 0;
  if (value.command === "refreshRepository") return true;
  return (
    value.command === "echo" &&
    Number.isSafeInteger(value.requestId) &&
    typeof value.value === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

