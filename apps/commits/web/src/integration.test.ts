import { expect, it } from "vitest";
import { sourceGroups } from "./integration";
it("groups favorites first, then alphabetical groups and ungrouped, deduplicating per source", () => {
  const repository = (name: string, group?: string, favorite = false) => ({ name, path: `C:/${name}`, available: true, group, favorite });
  expect(sourceGroups({ name: "Caller", repositories: [repository("z", "z"), repository("u"), repository("f", "z", true), repository("a", "a"), repository("a", "a")] }).map((group) => [group.name, group.repositories.map((entry) => entry.name)])).toEqual([["Favorites", ["f"]], ["a", ["a"]], ["z", ["z"]], ["", ["u"]]]);
});
