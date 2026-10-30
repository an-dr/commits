import { describe, expect, it } from "vitest";
import { PendingRequests } from "./pending-requests";

type Entry = { readonly kind: "clone" } | { readonly kind: "read"; readonly path: string };

describe("PendingRequests", () => {
  it("hands an entry back once, by the id it was sent with", () => {
    const pending = new PendingRequests<Entry>();
    pending.add(7, { kind: "read", path: "a.ts" });

    expect(pending.take(7)).toEqual({ kind: "read", path: "a.ts" });
    expect(pending.take(7)).toBeUndefined();
  });

  it("ignores an id nothing is waiting on", () => {
    expect(new PendingRequests<Entry>().take(1)).toBeUndefined();
  });

  it("reports a kind as in flight until its result is taken", () => {
    const pending = new PendingRequests<Entry>();
    pending.add(1, { kind: "clone" });
    pending.add(2, { kind: "read", path: "a.ts" });

    expect(pending.has("clone")).toBe(true);
    pending.take(1);
    expect(pending.has("clone")).toBe(false);
    expect(pending.has("read")).toBe(true);
  });
});
