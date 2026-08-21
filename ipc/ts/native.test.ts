import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Reader, Writer } from "./codec";
import {
  decodeGitResult,
  decodeNativeResult,
  decodeUpdaterResult,
  decodeWatchEvent,
  encodeGitCancel,
  encodeGitRun,
  encodeFileRead,
  encodeOsRequest,
  encodeToolRun,
  encodeUpdaterRequest,
  encodeWatchRequest,
} from "./native";

const fixtures = JSON.parse(readFileSync(
  fileURLToPath(new URL("../fixtures/native.json", import.meta.url)),
  "utf8",
)) as Record<string, string>;
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);

describe("native protocol", () => {
  it("encodes a deterministic Git request", () => {
    const reader = new Reader(encodeGitRun({
      requestId: 7,
      cwd: "C:/repo",
      args: ["--version"],
      env: { LANG: "C" },
      timeoutMs: 5000,
    }));
    expect(reader.u8()).toBe(0);
    expect(reader.u32()).toBe(7);
    expect(reader.string()).toBe("C:/repo");
    expect(reader.u16()).toBe(1);
    expect(reader.string()).toBe("--version");
    expect(reader.u16()).toBe(1);
    expect([reader.string(), reader.string()]).toEqual(["LANG", "C"]);
    expect(reader.u32()).toBe(5000);
    expect(() => reader.finish()).not.toThrow();
    expect(toHex(encodeGitRun({
      requestId: 7,
      cwd: "C:/repo",
      args: ["--version"],
      env: { LANG: "C" },
      timeoutMs: 5000,
    }))).toBe(fixtures.git_run);
    expect(encodeGitCancel(7)).toEqual(Uint8Array.of(1, 7, 0, 0, 0));
  });

  it("decodes Git and native results", () => {
    const git = new Writer()
      .u32(9).u8(0).i32(0)
      .blob(new TextEncoder().encode("git version"))
      .blob(new Uint8Array())
      .finish();
    expect(decodeGitResult(git)).toMatchObject({
      requestId: 9,
      status: "completed",
      exitCode: 0,
    });
    expect(new TextDecoder().decode(decodeGitResult(git).stdout)).toBe("git version");
    expect(decodeGitResult(fromHex(fixtures.git_result))).toMatchObject({
      requestId: 9,
      status: "completed",
      exitCode: 0,
    });

    const native = new Writer().u32(3).u8(1).string("C:/repo").string("").finish();
    expect(decodeNativeResult(native)).toEqual({
      requestId: 3,
      accepted: true,
      value: "C:/repo",
      error: "",
    });
  });

  it("assigns stable watcher and OS action tags", () => {
    expect(encodeWatchRequest(1, "start", "x")[4]).toBe(0);
    expect(encodeWatchRequest(1, "stop", "x")[4]).toBe(1);
    expect(encodeOsRequest(1, "clipboard-read")[4]).toBe(0);
    expect(encodeOsRequest(1, "pick-folder")[4]).toBe(4);
    expect(encodeOsRequest(1, "read-file")[4]).toBe(5);
    expect(encodeOsRequest(1, "reveal-directory")[4]).toBe(6);
    expect(encodeOsRequest(1, "fetch-url")[4]).toBe(7);
    // A file read carries its repository and path as one value, so the host can
    // confine the read without a second field on the wire.
    expect(encodeFileRead("C:/repo", "src/a.ts")).toBe("C:/repo\nsrc/a.ts");
    expect(toHex(encodeWatchRequest(1, "start", "C:/repo"))).toBe(fixtures.watch_start);
    expect(toHex(encodeOsRequest(2, "pick-folder", "Choose repository")))
      .toBe(fixtures.os_pick_folder);
  });

  it("frames a tool run so the host can tell its fields apart", () => {
    expect(encodeOsRequest(1, "run-tool")[4]).toBe(9);
    // Opening a repository carries no diff sides, so all four of their lines
    // are empty and the arguments start straight after them.
    expect(encodeToolRun({ program: "code", args: ["-n", "C:/repo"] })).toBe(
      "code\n\n\n\n\n-n\nC:/repo",
    );
    expect(encodeToolRun({
      program: "code",
      args: ["--diff", "{left}", "{right}"],
      left: { name: "a.ts", base64: "YQ==" },
      right: { name: "a.ts", base64: "Yg==" },
    })).toBe(
      "code\na.ts\nYQ==\na.ts\nYg==\n--diff\n{left}\n{right}",
    );
  });

  it("refuses a tool run whose newline would break the framing", () => {
    expect(() => encodeToolRun({ program: "code", args: ["C:/re\npo"] })).toThrow(
      "may not contain a newline",
    );
  });

  it("rejects unknown result tags and truncated payloads", () => {
    expect(() => decodeGitResult(Uint8Array.of(1, 0, 0, 0, 9))).toThrow(
      "unknown git result status",
    );
    expect(() => decodeNativeResult(Uint8Array.of(1))).toThrow("truncated");
    expect(() => decodeWatchEvent(Uint8Array.of(1, 0, 0, 0, 3))).toThrow(
      "unknown watch event kind",
    );
  });

  it("encodes an updater request and decodes its result", () => {
    expect(encodeUpdaterRequest(3, "check", "https://example.com/manifest.json"))
      .toEqual(new Writer().u32(3).u8(0).string("https://example.com/manifest.json").finish());
    expect(encodeUpdaterRequest(3, "stage", "https://example.com/manifest.json")[4]).toBe(1);
    expect(encodeUpdaterRequest(3, "install", "")[4]).toBe(2);

    const result = new Writer().u32(3).u8(1).u8(1).u8(0).string("1.2.0").string("").finish();
    expect(decodeUpdaterResult(result)).toEqual({
      requestId: 3,
      ok: true,
      available: true,
      fresh: false,
      version: "1.2.0",
      error: "",
    });
  });
});
