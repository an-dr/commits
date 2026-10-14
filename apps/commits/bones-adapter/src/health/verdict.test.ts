import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verdictOf, VERDICTS, type HealthFacts } from "./verdict";
const vectors = JSON.parse(readFileSync(new URL("./repository-health.vectors.json", import.meta.url), "utf8")) as {
  verdicts: typeof VERDICTS; cases: { name: string; facts: HealthFacts; verdict: string }[];
};
describe("repository health conformance", () => {
  it("publishes exactly the implementation's verdict table and covers every verdict", () => {
    expect(vectors.verdicts).toEqual(VERDICTS);
    expect(new Set(vectors.cases.map((vector) => verdictOf(vector.facts).id))).toEqual(new Set(VERDICTS.map((verdict) => verdict.id)));
  });
  for (const vector of vectors.cases) it(vector.name, () => expect(verdictOf(vector.facts).id).toBe(vector.verdict));
});
