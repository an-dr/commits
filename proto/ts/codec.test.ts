import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Reader, Writer } from "./codec";
import {
  decodePageMessage,
  decodePanelFailed,
  encodeClosePanel,
  encodeNavigate,
  encodeOpenPanel,
  encodeSendJson,
} from "./web";

const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/web.json", import.meta.url)),
    "utf8",
  ),
) as Record<string, string>;
const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("bones codec", () => {
  it("round-trips every fixed-layout primitive", () => {
    const payload = new Writer()
      .u8(255)
      .u16(65530)
      .u32(4_000_000_000)
      .i32(-123)
      .f32(1.5)
      .string("Příliš")
      .blob(Uint8Array.of(0, 1, 2))
      .finish();
    const reader = new Reader(payload);

    expect(reader.u8()).toBe(255);
    expect(reader.u16()).toBe(65530);
    expect(reader.u32()).toBe(4_000_000_000);
    expect(reader.i32()).toBe(-123);
    expect(reader.f32()).toBe(1.5);
    expect(reader.string()).toBe("Příliš");
    expect(reader.blob()).toEqual(Uint8Array.of(0, 1, 2));
    expect(() => reader.finish()).not.toThrow();
  });

  it("matches Rust-generated web command fixtures", () => {
    expect(toHex(encodeOpenPanel("main", { kind: "html", value: "<h1>commits</h1>" })))
      .toBe(fixtures.open_html);
    expect(toHex(encodeClosePanel("main"))).toBe(fixtures.close);
    expect(toHex(encodeNavigate("main", "https://example.com/commits")))
      .toBe(fixtures.navigate);
    expect(toHex(encodeSendJson("main", '{"command":"coreReady","runtime":"bones"}')))
      .toBe(fixtures.send_json);
  });

  it("decodes Rust-generated page and lifecycle fixtures", () => {
    expect(decodePageMessage(fromHex(fixtures.page_message))).toEqual({
      owner: "commits",
      panel: "main",
      json: '{"command":"echo","requestId":7,"value":"bones"}',
    });
    expect(decodePanelFailed(fromHex(fixtures.panel_failed))).toEqual({
      owner: "commits",
      panel: "main",
      reason: "backend unavailable",
    });
  });

  it("rejects truncation, invalid UTF-8, and trailing bytes", () => {
    expect(() => new Reader(Uint8Array.of(4, 0, 65)).string()).toThrow(
      "truncated",
    );
    expect(() => new Reader(Uint8Array.of(255)).stringRest()).toThrow();
    expect(() => {
      const reader = new Reader(Uint8Array.of(1));
      reader.finish();
    }).toThrow("trailing bytes");
  });

  it("rejects integers that Rust types cannot represent", () => {
    expect(() => new Writer().u8(256)).toThrow("u8 value is out of range");
    expect(() => new Writer().u16(-1)).toThrow("u16 value is out of range");
    expect(() => new Writer().u32(2 ** 32)).toThrow("u32 value is out of range");
    expect(() => new Writer().i32(2 ** 31)).toThrow("i32 value is out of range");
  });
});
