import { describe, expect, it } from "vitest";
import {
  dropActionsFor,
  parseDraggedRef,
  readDraggedRef,
  serializeDraggedRef,
  type DraggedRef
} from "./dragDrop";

describe("readDraggedRef", () => {
  it("reads a branch badge", () => {
    expect(readDraggedRef({ dragRefType: "branch", dragRefName: "main" })).toEqual({
      type: "branch",
      name: "main"
    });
  });

  it("carries the tag type when the badge was rendered with one", () => {
    expect(
      readDraggedRef({ dragRefType: "tag", dragRefName: "v1.0.0", tagtype: "annotated" })
    ).toEqual({ type: "tag", name: "v1.0.0", tagType: "annotated" });
  });

  it("leaves the tag type out rather than inventing one", () => {
    const ref = readDraggedRef({ dragRefType: "tag", dragRefName: "v1.0.0", tagtype: "whatever" });

    expect(ref).toEqual({ type: "tag", name: "v1.0.0" });
    expect(ref).not.toHaveProperty("tagType", "whatever");
  });

  it("returns null for an element that is not a ref badge", () => {
    expect(readDraggedRef({})).toBeNull();
    expect(readDraggedRef({ dragRefType: "remote", dragRefName: "origin/main" })).toBeNull();
    expect(readDraggedRef({ dragRefType: "branch", dragRefName: "" })).toBeNull();
  });
});

describe("parseDraggedRef", () => {
  it("reads back what the drag wrote", () => {
    const ref: DraggedRef = { type: "tag", name: "v1.0.0", tagType: "lightweight" };

    expect(parseDraggedRef(serializeDraggedRef(ref))).toEqual(ref);
  });

  it("rejects a payload from somewhere else instead of half-reading it", () => {
    expect(parseDraggedRef("")).toBeNull();
    expect(parseDraggedRef("not json")).toBeNull();
    expect(parseDraggedRef("null")).toBeNull();
    expect(parseDraggedRef('"main"')).toBeNull();
    expect(parseDraggedRef(JSON.stringify({ type: "remote", name: "origin/main" }))).toBeNull();
    expect(parseDraggedRef(JSON.stringify({ type: "branch" }))).toBeNull();
    expect(parseDraggedRef(JSON.stringify({ type: "branch", name: "" }))).toBeNull();
  });

  it("drops a tag type it does not recognize, keeping the ref", () => {
    expect(parseDraggedRef(JSON.stringify({ type: "tag", name: "v1", tagType: "signed" }))).toEqual({
      type: "tag",
      name: "v1"
    });
  });
});

describe("dropActionsFor", () => {
  it("moves a branch that is not checked out", () => {
    expect(dropActionsFor({ type: "branch", name: "feature" }, { currentBranch: "main" })).toEqual([
      "moveBranch"
    ]);
  });

  it("offers reset and rebase for the checked-out branch, which cannot just move", () => {
    expect(dropActionsFor({ type: "branch", name: "main" }, { currentBranch: "main" })).toEqual([
      "resetHead",
      "rebase"
    ]);
  });

  it("offers nothing for HEAD itself, which is no branch to move", () => {
    expect(dropActionsFor({ type: "branch", name: "HEAD" }, { currentBranch: null })).toEqual([]);
  });

  it("moves any branch while HEAD is detached, since none is checked out", () => {
    expect(dropActionsFor({ type: "branch", name: "main" }, { currentBranch: null })).toEqual([
      "moveBranch"
    ]);
  });

  it("moves a tag whatever branch is checked out", () => {
    expect(dropActionsFor({ type: "tag", name: "v1.0.0" }, { currentBranch: "v1.0.0" })).toEqual([
      "moveTag"
    ]);
  });
});
