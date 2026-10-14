import { describe, expect, it } from "vitest";
import { REQUEST_ID_BANDS, REQUEST_ID_BAND_SIZE, RequestIds, isInBand } from "./request-ids";

describe("request ids", () => {
  it("keeps every band disjoint", () => {
    const starts = Object.values(REQUEST_ID_BANDS).sort((a, b) => a - b);
    for (let index = 1; index < starts.length; index++) {
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(REQUEST_ID_BAND_SIZE);
    }
  });

  it("wraps within its own band", () => {
    const ids = new RequestIds("health");
    const issued = Array.from({ length: REQUEST_ID_BAND_SIZE + 1 }, () => ids.next());
    expect(issued.every((id) => isInBand(id, "health"))).toBe(true);
    expect(issued.at(-1)).toBe(REQUEST_ID_BANDS.health);
  });
});
