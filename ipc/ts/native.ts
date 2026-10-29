import { DesktopRequestAction, DesktopResultTag, OsRequestAction, UpgraderRequestAction, UpgraderResultTag } from "./bones-messages";
import { Reader, Writer } from "./codec";

export interface LaunchOptions {
  readonly sequence?: number;
  readonly show?: "changes" | "conflicts" | "graph" | null;
  readonly branch?: string | null;
  readonly commit?: string | null;
  readonly theme?: "light" | "dark" | null;
  readonly themeFile?: unknown;
  readonly themeFileName?: string;
  readonly themeFileError?: string;
}
export type LaunchRequest = LaunchOptions & (
  | { readonly kind: "none" }
  | { readonly kind: "repository"; readonly paths: readonly string[] }
  | { readonly kind: "rejected"; readonly reason: string }
);

export function decodeLaunchRequest(bytes: Uint8Array): LaunchRequest {
  const reader = new Reader(bytes);
  const sequence = reader.u32();
  const value = JSON.parse(new TextDecoder().decode(reader.blob()));
  reader.finish();
  if (!value || !["none", "repository", "rejected"].includes(value.kind)) throw new Error("invalid launch outcome");
  if (value.kind === "repository" && (!Array.isArray(value.paths) || !value.paths.every((path: unknown) => typeof path === "string"))) throw new Error("invalid launch paths");
  if (value.kind === "rejected" && typeof value.reason !== "string") throw new Error("invalid launch rejection");
  return { ...value, sequence };
}

/** `lastApplied` asks which version ran before this one, for the Updated notice. */
export function encodeUpgraderRequest(requestId: number, action: UpdaterAction | "lastApplied"): Uint8Array {
  return new Writer().u32(requestId).u8(UpgraderRequestAction[action]).finish();
}

export function encodeDesktopRequest(requestId: number, action: DesktopAction): Uint8Array {
  return new Writer().u32(requestId).u8(DesktopRequestAction[action]).finish();
}

/** Bones owns the update and desktop vocabularies; normalize outcomes for the app menu. */
export function decodeUpgradeResult(bytes: Uint8Array): UpdaterResult & { previous?: string | null } {
  const reader = new Reader(bytes);
  const requestId = reader.u32();
  const tag = reader.u8();
  const result: UpdaterResult & { previous?: string | null } = { requestId, ok: tag !== UpgraderResultTag.failed, available: tag === UpgraderResultTag.available, fresh: false, version: "", error: "" };
  const rest = (): string => reader.stringRest();
  switch (tag) {
    case UpgraderResultTag.available: case UpgraderResultTag.staged: result.version = rest(); return result;
    case UpgraderResultTag.upToDate: reader.finish(); return result;
    case UpgraderResultTag.installed: result.fresh = reader.u8() !== 0; reader.finish(); return result;
    case UpgraderResultTag.lastApplied: { const present = reader.u8() !== 0; const previous = reader.string(); result.previous = present ? previous : null; result.version = rest(); return result; }
    case UpgraderResultTag.failed: result.error = rest(); return result;
    default: throw new Error("unknown upgrade result");
  }
}

export function decodeDesktopResult(bytes: Uint8Array): DesktopResult {
  const reader = new Reader(bytes);
  const requestId = reader.u32();
  const tag = reader.u8();
  if (tag === DesktopResultTag.registered) { reader.u8(); reader.finish(); return { requestId, ok: true, error: "" }; }
  if (tag !== DesktopResultTag.failed) throw new Error("unknown desktop result");
  return { requestId, ok: false, error: new TextDecoder().decode(bytes.slice(5)) };
}

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

/**
 * Actions the engine's generic `os` endpoint accepts.
 *
 * Nothing here needs a repository, which is what makes the endpoint reusable
 * by any desktop host rather than only by this one.
 */
export type OsAction =
  | "clipboard-read"
  | "clipboard-write"
  | "open-url"
  | "pick-file"
  | "pick-folder"
  | "reveal-directory"
  | "fetch-url";

/**
 * Actions this application's git-aware `repo-os` endpoint accepts.
 *
 * Each needs a repository to mean anything: a read confined to one, a scan for
 * them, or a tool launched against one. They number from zero independently of
 * `OsAction`, because the two endpoints are separate wire surfaces.
 */
export type RepoOsAction =
  | "read-file"
  | "find-repositories"
  | "run-tool"
  | "start-github-device-code"
  | "poll-github-token"
  | "store-github-token";

/**
 * Value of a `read-file` request: the repository the read is confined to, then
 * the path to read, separated by a newline. The host resolves the path inside
 * that repository and refuses anything that leaves it.
 */
export function encodeFileRead(repository: string, path: string): string {
  return `${repository}
${path}`;
}

export function encodeOsRequest(
  requestId: number,
  action: OsAction,
  value = "",
): Uint8Array {
  const tag: Record<OsAction, number> = {
    "clipboard-read": OsRequestAction.readClipboard,
    "clipboard-write": OsRequestAction.writeClipboard,
    "open-url": OsRequestAction.openUrl,
    "pick-file": OsRequestAction.pickFile,
    "pick-folder": OsRequestAction.pickFolder,
    "reveal-directory": OsRequestAction.openDirectory,
    "fetch-url": OsRequestAction.fetchUrl,
  };
  return new Writer().u32(requestId).u8(tag[action]).string(value).finish();
}

export function encodeRepoOsRequest(
  requestId: number,
  action: RepoOsAction,
  value = "",
): Uint8Array {
  const tag: Record<RepoOsAction, number> = {
    "read-file": 0,
    "find-repositories": 1,
    "run-tool": 2,
    "start-github-device-code": 3,
    "poll-github-token": 4,
    "store-github-token": 5,
  };
  return new Writer().u32(requestId).u8(tag[action]).string(value).finish();
}


/** One file the host writes before the tool runs, for a side of a diff. */
export interface ToolBlob {
  /** Suggested file name; the host strips any directory part from it. */
  name: string;
  /** The file's bytes, base64-encoded, since the value is carried as text. */
  base64: string;
}

/**
 * A run of one external tool.
 *
 * `args` is an argument vector, never a command line: the host passes it to
 * the program as-is, so a repository path with a space in it -- or a file name
 * carrying a shell metacharacter -- cannot turn into a second command.
 *
 * `left` and `right` are the two sides of a diff. The host writes each to a
 * temporary file and substitutes its path for the `{left}` and `{right}`
 * placeholders in `args`, because a diff tool takes two paths on disk and the
 * revisions being compared are not on disk anywhere.
 */
export interface ToolRun {
  program: string;
  args: string[];
  left?: ToolBlob;
  right?: ToolBlob;
}

/**
 * Value of a `run-tool` request.
 *
 * The lines are, in order: the program, the left file's name and contents, the
 * right file's name and contents, and then one argument per line. Empty name
 * and contents lines mean that side is absent, which is the ordinary case for
 * anything but a diff. A newline inside any field would break that framing, so
 * it is rejected here rather than silently corrupting the run.
 */
export function encodeToolRun(run: ToolRun): string {
  const fields = [
    run.program,
    run.left?.name ?? "",
    run.left?.base64 ?? "",
    run.right?.name ?? "",
    run.right?.base64 ?? "",
    ...run.args,
  ];
  if (fields.some((field) => field.includes("\n"))) {
    throw new Error("a tool run may not contain a newline");
  }
  return fields.join("\n");
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

/** Bones' upgrade module: `check` compares the release source with this
 * build, `stage` downloads a newer version, and `install` copies the running
 * build to the canonical location. */
export type UpdaterAction = "check" | "stage" | "install";

/** Bones' desktop module: registers or removes the installed entry point. */
export type DesktopAction = "register" | "unregister";

/** Outcome of a {@link DesktopAction}. */
export interface DesktopResult {
  requestId: number;
  ok: boolean;
  error: string;
}

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
