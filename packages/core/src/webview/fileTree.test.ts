import { describe, expect, it } from "vitest";
import { buildFileTree, renderFileTree } from "./fileTree";

/** Names every leaf it is handed, so a test can read the traversal order back. */
const nameLeaf = (index: number, name: string): string => `<li>${index}:${name}</li>`;

describe("buildFileTree", () => {
  it("nests a path under one folder per segment", () => {
    const tree = buildFileTree(["src/webview/main.ts"]);

    const src = <GitFolder>tree.contents["src"];
    const webview = <GitFolder>src.contents["webview"];
    expect(src.type).toBe("folder");
    expect(src.folderPath).toBe("src");
    expect(webview.folderPath).toBe("src/webview");
    expect(webview.contents["main.ts"]).toEqual({ type: "file", name: "main.ts", index: 0 });
  });

  it("remembers each leaf's position in the source array", () => {
    const tree = buildFileTree(["b.ts", "a/deep.ts", "c.ts"]);

    expect((<GitFile>tree.contents["b.ts"]).index).toBe(0);
    expect((<GitFile>(<GitFolder>tree.contents["a"]).contents["deep.ts"]).index).toBe(1);
    expect((<GitFile>tree.contents["c.ts"]).index).toBe(2);
  });

  it("shares one folder between files that live in it", () => {
    const tree = buildFileTree(["src/one.ts", "src/two.ts"]);

    expect(Object.keys(tree.contents)).toEqual(["src"]);
    expect(Object.keys((<GitFolder>tree.contents["src"]).contents)).toEqual(["one.ts", "two.ts"]);
  });

  it("returns an empty root for no paths", () => {
    expect(buildFileTree([]).contents).toEqual({});
  });
});

describe("renderFileTree", () => {
  it("delegates every file row to the caller", () => {
    const html = renderFileTree(buildFileTree(["a.ts", "dir/b.ts"]), nameLeaf);

    expect(html).toContain("<li>0:a.ts</li>");
    expect(html).toContain("<li>1:b.ts</li>");
  });

  it("orders folders before files, then by name", () => {
    const html = renderFileTree(buildFileTree(["z.ts", "a.ts", "beta/x.ts", "alpha/y.ts"]), nameLeaf);

    const order = [...html.matchAll(/(?:gitFolderName">([^<]+)|<li>\d+:([^<]+))/g)].map(
      (match) => match[1] ?? match[2]
    );
    expect(order).toEqual(["alpha", "y.ts", "beta", "x.ts", "a.ts", "z.ts"]);
  });

  it("gives the root no folder header of its own", () => {
    expect(renderFileTree(buildFileTree(["a.ts"]), nameLeaf)).not.toContain("gitFolder ");
    expect(renderFileTree(buildFileTree(["a.ts"]), nameLeaf).startsWith("<ul")).toBe(true);
  });

  it("marks a closed folder and hides its contents", () => {
    const tree = buildFileTree(["dir/a.ts"]);
    (<GitFolder>tree.contents["dir"]).open = false;

    const html = renderFileTree(tree, nameLeaf);

    expect(html).toContain('<li class="closed">');
    expect(html).toContain('class="gitFolderContents hidden"');
  });

  it("escapes a folder name rather than trusting the path", () => {
    const tree = buildFileTree(["<script>/a.ts"]);

    expect(renderFileTree(tree, nameLeaf)).toContain("&lt;script&gt;");
  });

  it("closes every list it opens", () => {
    const html = renderFileTree(buildFileTree(["a/b/c.ts", "d.ts"]), nameLeaf);

    expect([...html.matchAll(/<ul/g)].length).toBe([...html.matchAll(/<\/ul>/g)].length);
  });
});
