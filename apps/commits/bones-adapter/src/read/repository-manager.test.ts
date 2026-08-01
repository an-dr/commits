import { describe, expect, it } from "vitest";
import { RepositoryManager } from "./repository-manager";

describe("RepositoryManager", () => {
  it("reconciles host paths without a VS Code workspace dependency", () => {
    const paths = { getRootPaths: () => ["C:\\Code\\Outer", "c:/code/outer/"] };
    const manager = new RepositoryManager(paths);

    manager.discover();

    expect(manager.all()).toEqual([
      { id: "c:/code/outer", path: "C:/Code/Outer", source: "host" },
    ]);
  });

  it("retains nested and externally chosen repositories across discovery", () => {
    let visible = ["C:/Code/app"];
    const manager = new RepositoryManager({ getRootPaths: () => visible });
    manager.discover();
    manager.addExternal("C:/Code/app/tools/fixture");
    visible = [];
    manager.discover();

    expect(manager.all()).toEqual([
      { id: "c:/code/app/tools/fixture", path: "C:/Code/app/tools/fixture", source: "external" },
    ]);
  });

  it("ignores blank paths and allows removing a saved external repository", () => {
    const manager = new RepositoryManager({ getRootPaths: () => ["  "] });
    expect(manager.addExternal(" ")).toBeNull();
    const repository = manager.addExternal("C:/external");
    manager.removeExternal(repository!.id);
    expect(manager.all()).toEqual([]);
  });
});
