import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  decodeDesktopResult,
  decodeNativeResult,
  decodeUpgradeResult,
  encodeDesktopRequest,
  encodeOsRequest,
  encodeUpgraderRequest,
  type DesktopAction,
  type OsAction,
  type UpdaterAction,
} from "./native";
import {
  decodePageMessage,
  decodePanelClosed,
  decodePanelFailed,
  decodePanelOpened,
  encodeClosePanel,
  encodeNavigate,
  encodeOpenPanel,
  encodeSendJson,
} from "./web";

/**
 * Holds the hand-written codec to bones' own conformance vectors, generated
 * from `bones-messages`, for every bones topic and endpoint Commits speaks.
 * A vector bones adds for one of these surfaces fails here until it is either
 * checked or listed in `UNUSED` with the reason Commits never sends it.
 */
const VECTORS = fileURLToPath(new URL("../../vendor/bones/wit/vectors/vectors.txt", import.meta.url));
const SURFACES = /^(web|web\/.+|desktop\/.+|os\/.+|upgrader\/.+)$/;

type Fields = Record<string, string>;
interface Vector {
  readonly target: string;
  readonly bytes: Uint8Array;
  readonly fields: Fields;
  readonly line: string;
}

const OS_ACTIONS: readonly OsAction[] = [
  "clipboard-read",
  "clipboard-write",
  "open-url",
  "pick-file",
  "pick-folder",
  "reveal-directory",
  "fetch-url",
];
const UPGRADER_ACTIONS = ["check", "stage", "install", "lastApplied"] as const;
const DESKTOP_ACTIONS: readonly DesktopAction[] = ["register", "unregister"];

/** Vectors for surfaces Commits shares but values it never sends. */
const UNUSED: Record<string, string> = {
  "desktop/request 0200000002": "Commits never asks for the registration status",
};

/** Checks one vector, or returns false when no codec covers it. */
function check(vector: Vector): boolean {
  const { target, bytes, fields } = vector;
  const id = Number(fields.request_id);
  switch (target) {
    case "web/panel-opened":
      expect(decodePanelOpened(bytes)).toEqual({ owner: fields.owner, panel: fields.panel });
      return true;
    case "web/panel-closed":
      expect(decodePanelClosed(bytes)).toEqual({ owner: fields.owner, panel: fields.panel });
      return true;
    case "web/panel-failed":
      expect(decodePanelFailed(bytes)).toEqual({ owner: fields.owner, panel: fields.panel, reason: fields.reason });
      return true;
    case "web/page-message":
      expect(decodePageMessage(bytes)).toEqual({ owner: fields.owner, panel: fields.panel, json: fields.json });
      return true;
    case "web":
      expect(hex(encodeWeb(fields))).toBe(hex(bytes));
      return true;
    case "desktop/request":
      expect(hex(encodeDesktopRequest(id, DESKTOP_ACTIONS[Number(fields.action)]))).toBe(hex(bytes));
      return true;
    case "desktop/result":
      expect(decodeDesktopResult(bytes)).toEqual({ requestId: id, ok: fields.tag === "0", error: fields.reason ?? "" });
      return true;
    case "os/request":
      expect(hex(encodeOsRequest(id, OS_ACTIONS[Number(fields.action)], fields.value))).toBe(hex(bytes));
      return true;
    case "os/result":
      expect(decodeNativeResult(bytes)).toEqual({
        requestId: id,
        accepted: fields.accepted === "1",
        value: fields.value,
        error: fields.error,
      });
      return true;
    case "upgrader/request": {
      const action = UPGRADER_ACTIONS[Number(fields.action)] as UpdaterAction | "lastApplied";
      expect(hex(encodeUpgraderRequest(id, action))).toBe(hex(bytes));
      return true;
    }
    case "upgrader/result":
      expect(decodeUpgradeResult(bytes)).toMatchObject(expectedUpgrade(fields));
      return true;
    default:
      return false;
  }
}

function encodeWeb(fields: Fields): Uint8Array {
  switch (fields.tag) {
    case "0":
      return encodeOpenPanel(fields.panel, { kind: fields.source_kind === "0" ? "html" : "url", value: fields.source });
    case "1":
      return encodeClosePanel(fields.panel);
    case "2":
      return encodeNavigate(fields.panel, fields.url);
    case "3":
      return encodeSendJson(fields.panel, fields.json);
    default:
      throw new Error(`unknown web tag ${fields.tag}`);
  }
}

/** The app menu's reading of each `upgrader::Outcome`. */
function expectedUpgrade(fields: Fields): object {
  const requestId = Number(fields.request_id);
  switch (fields.tag) {
    case "0":
      return { requestId, ok: true, available: true, version: fields.version };
    case "1":
      return { requestId, ok: true, available: false };
    case "2":
      return { requestId, ok: true, available: false, version: fields.version };
    case "3":
      return { requestId, ok: true, fresh: fields.fresh === "true" };
    case "4":
      return {
        requestId,
        ok: true,
        previous: fields.has_previous === "true" ? fields.previous : null,
        version: fields.current,
      };
    case "5":
      return { requestId, ok: false, error: fields.reason };
    default:
      throw new Error(`unknown upgrader tag ${fields.tag}`);
  }
}

function readVectors(): Vector[] {
  return readFileSync(VECTORS, "utf8")
    .split(/\r?\n/)
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [target, payload, ...rest] = line.split(" ");
      return { target, bytes: unhex(payload), fields: parseFields(rest.join(" ")), line };
    })
    .filter((vector) => SURFACES.test(vector.target));
}

function parseFields(text: string): Fields {
  const fields: Fields = {};
  for (const part of text.split(";")) {
    const equals = part.indexOf("=");
    if (equals > 0) fields[part.slice(0, equals)] = part.slice(equals + 1);
  }
  return fields;
}

function unhex(text: string): Uint8Array {
  if (text === "-") return new Uint8Array();
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("bones conformance vectors", () => {
  const vectors = readVectors();

  it("cover every surface Commits shares with bones", () => {
    expect(new Set(vectors.map((vector) => vector.target.split("/")[0]))).toEqual(
      new Set(["web", "desktop", "os", "upgrader"]),
    );
  });

  it.each(vectors.map((vector) => [vector.line, vector] as const))("%s", (_line, vector) => {
    const key = `${vector.target} ${hex(vector.bytes)}`;
    if (key in UNUSED) return;
    expect(check(vector), `no codec covers ${vector.target}`).toBe(true);
  });

  it("lists only unused vectors that still exist", () => {
    const keys = new Set(vectors.map((vector) => `${vector.target} ${hex(vector.bytes)}`));
    expect(Object.keys(UNUSED).filter((key) => !keys.has(key))).toEqual([]);
  });
});
