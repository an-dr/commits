import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Reader, Writer } from "./codec";
import {
  decodeGitResult,
  decodeNativeResult,
  decodeWatchEvent,
  encodeGitCancel,
  encodeGitRun,
  encodeOsRequest,
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
    expect(toHex(encodeWatchRequest(1, "start", "C:/repo"))).toBe(fixtures.watch_start);
    expect(toHex(encodeOsRequest(2, "pick-folder", "Choose repository")))
      .toBe(fixtures.os_pick_folder);
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
});
