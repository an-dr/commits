import { Reader, Writer } from "./codec";

export interface GitRun {
  requestId: number;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface GitResult {
  requestId: number;
  status: "completed" | "cancelled" | "failed";
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export function encodeGitRun(request: GitRun): Uint8Array {
  const env = Object.entries(request.env ?? {});
  const writer = new Writer()
    .u8(0)
    .u32(request.requestId)
    .string(request.cwd)
    .u16(request.args.length);
  request.args.forEach((arg) => writer.string(arg));
  writer.u16(env.length);
  env.forEach(([name, value]) => writer.string(name).string(value));
  return writer.u32(request.timeoutMs ?? 0).finish();
}

export function encodeGitCancel(requestId: number): Uint8Array {
  return new Writer().u8(1).u32(requestId).finish();
}

export function decodeGitResult(bytes: Uint8Array): GitResult {
  const reader = new Reader(bytes);
  const requestId = reader.u32();
  const status = ["completed", "cancelled", "failed"][reader.u8()];
  if (status === undefined) {
    throw new Error("unknown git result status");
  }
  const result: GitResult = {
    requestId,
    status: status as GitResult["status"],
    exitCode: reader.i32(),
    stdout: reader.blob(),
    stderr: reader.blob(),
  };
  reader.finish();
  return result;
}

export function encodeWatchRequest(
  requestId: number,
  action: "start" | "stop",
  repository: string,
): Uint8Array {
  return new Writer()
    .u32(requestId)
    .u8(action === "start" ? 0 : 1)
    .string(repository)
    .finish();
}

export type OsAction =
  | "clipboard-read"
  | "clipboard-write"
  | "open-url"
  | "pick-file"
  | "pick-folder"
  | "read-file"
  | "reveal-directory"
  | "fetch-url"
  | "find-repositories";

/**
 * Value of a `read-file` request: the repository the read is confined to, then
 * the path to read, separated by a newline. The host resolves the path inside
 * that repository and refuses anything that leaves it.
 */
export function encodeFileRead(repository: string, path: string): string {
  return `${repository}\n${path}`;
}

export function encodeOsRequest(
  requestId: number,
  action: OsAction,
  value = "",
): Uint8Array {
  const tag: Record<OsAction, number> = {
    "clipboard-read": 0,
    "clipboard-write": 1,
    "open-url": 2,
    "pick-file": 3,
    "pick-folder": 4,
    "read-file": 5,
    "reveal-directory": 6,
    "fetch-url": 7,
    "find-repositories": 8,
  };
  return new Writer().u32(requestId).u8(tag[action]).string(value).finish();
}

export interface NativeResult {
  requestId: number;
  accepted: boolean;
  value: string;
  error: string;
}

export interface WatchEvent {
  requestId: number;
  kind: "full" | "lightweight";
  repository: string;
  path: string;
}

export function decodeWatchEvent(bytes: Uint8Array): WatchEvent {
  const reader = new Reader(bytes);
  const requestId = reader.u32();
  const kind = ["full", "lightweight"][reader.u8()];
  if (kind === undefined) {
    throw new Error("unknown watch event kind");
  }
  const event = {
    requestId,
    kind: kind as WatchEvent["kind"],
    repository: reader.string(),
    path: reader.string(),
  };
  reader.finish();
  return event;
}

export function decodeNativeResult(bytes: Uint8Array): NativeResult {
  const reader = new Reader(bytes);
  const result = {
    requestId: reader.u32(),
    accepted: reader.u8() !== 0,
    value: reader.string(),
    error: reader.string(),
  };
  reader.finish();
  return result;
}

/** `install` stages the running build itself and ignores `manifestUrl`. */
export type UpdaterAction = "check" | "stage" | "install";

/** `fresh` matters only for the `install` action: whether the files landed
 * directly at the install location (nothing was installed yet) rather than
 * staged for an existing launcher to apply on its next start. */
export interface UpdaterResult {
  requestId: number;
  ok: boolean;
  available: boolean;
  fresh: boolean;
  version: string;
  error: string;
}

/** `stage` re-fetches the manifest itself, so only the URL is ever needed. */
export function encodeUpdaterRequest(
  requestId: number,
  action: UpdaterAction,
  manifestUrl: string,
): Uint8Array {
  const tag: Record<UpdaterAction, number> = { check: 0, stage: 1, install: 2 };
  return new Writer()
    .u32(requestId)
    .u8(tag[action])
    .string(manifestUrl)
    .finish();
}

export function decodeUpdaterResult(bytes: Uint8Array): UpdaterResult {
  const reader = new Reader(bytes);
  const result = {
    requestId: reader.u32(),
    ok: reader.u8() !== 0,
    available: reader.u8() !== 0,
    fresh: reader.u8() !== 0,
    version: reader.string(),
    error: reader.string(),
  };
  reader.finish();
  return result;
}
