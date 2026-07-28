import { describe, expect, it } from "vitest";
import { relativeDate, shortHash } from "./format";

describe("repository display formatting", () => {
  it("keeps hashes concise and computes stable relative dates", () => {
    expect(shortHash("abcdef012345")).toBe("abcdef01");
    expect(relativeDate(1_000, 1_060_000)).toBe("1m ago");
    expect(relativeDate(1_000, 87_400_000)).toBe("1d ago");
  });
});
