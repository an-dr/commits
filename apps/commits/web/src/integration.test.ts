import { expect, it } from "vitest";
import { comparablePath, sourceGroups } from "./integration";
it("groups favorites first, then alphabetical groups and ungrouped, deduplicating per source", () => {
  const repository = (name: string, group?: string, favorite = false) => ({ name, path: `C:/${name}`, available: true, group, favorite });
  expect(sourceGroups({ name: "Caller", repositories: [repository("z", "z"), repository("u"), repository("f", "z", true), repository("a", "a"), repository("a", "a")] }).map((group) => [group.name, group.repositories.map((entry) => entry.name)])).toEqual([["Favorites", ["f"]], ["a", ["a"]], ["z", ["z"]], ["", ["u"]]]);
});
it("treats Windows paths that differ only in case or slashes as one folder", () => {
  expect(comparablePath("C:\\Code\\Repo\\")).toBe(comparablePath("c:/code/repo"));
  expect(comparablePath("\\\\server\\Share")).toBe(comparablePath("//SERVER/share"));
  expect(comparablePath("/home/Repo")).not.toBe(comparablePath("/home/repo"));
  const entry = (path: string) => ({ name: "repo", path, available: true });
  expect(sourceGroups({ name: "Caller", repositories: [entry("C:\\Code\\x"), entry("c:/code/x")] })[0].repositories).toHaveLength(1);
});
