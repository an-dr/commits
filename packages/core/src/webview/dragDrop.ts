/**
 * Dragging a ref badge onto a commit row.
 *
 * Everything here is free of the DOM so it can be tested: the view supplies
 * the dataset of the badge being dragged and the payload the drop carries,
 * and gets back the ref and the list of things that ref can do to the commit
 * it landed on. Wiring the events, opening the menu and asking Git are the
 * view's own work, in `main.ts`.
 */

/**
 * Private media type for the dragged ref.
 *
 * A page-specific type is what keeps a ref dragged out of some other window
 * from being read as one of ours: a foreign drag simply carries nothing under
 * this key, so the drop is ignored instead of half-understood. The name is
 * kept identical to the extension's, so a ref can be dragged between the two.
 */
export const REF_DRAG_MIME = "application/vnd.an-dr-commits-ref";

/** Tag object kinds Git distinguishes, and which `git tag` must be told. */
export type DraggedTagType = "annotated" | "lightweight";

/** A branch or tag badge in flight between its own row and another one. */
export interface DraggedRef {
  type: "branch" | "tag";
  name: string;
  /** Known only where the badge was rendered with it; absent otherwise. */
  tagType?: DraggedTagType;
}

/** What a dropped ref offers to do to the commit it was dropped on. */
export type DropActionKind = "moveBranch" | "resetHead" | "rebase" | "moveTag";

/** What the drop menu needs to know about the view around it. */
export interface DropContext {
  /** The checked-out branch, or null when HEAD is detached. */
  currentBranch: string | null;
}

/** The `data-*` attributes a draggable badge carries, as a DOM dataset. */
export interface DraggableRefDataset {
  dragRefType?: string;
  dragRefName?: string;
  tagtype?: string;
}

function asTagType(value: string | undefined): DraggedTagType | undefined {
  return value === "annotated" || value === "lightweight" ? value : undefined;
}

/**
 * Reads the ref out of a badge's dataset, or null when the element is not a
 * draggable ref badge at all.
 */
export function readDraggedRef(dataset: DraggableRefDataset): DraggedRef | null {
  const type = dataset.dragRefType;
  const name = dataset.dragRefName;
  if (name === undefined || name === "" || (type !== "branch" && type !== "tag")) {
    return null;
  }
  const tagType = asTagType(dataset.tagtype);
  return tagType === undefined ? { type, name } : { type, name, tagType };
}

/** Writes the ref into the string form the drag carries. */
export function serializeDraggedRef(ref: DraggedRef): string {
  return JSON.stringify(ref);
}

/**
 * Reads back what `serializeDraggedRef` wrote, rejecting anything else.
 *
 * A drag can come from any window the user has open, so the payload is
 * untrusted input rather than something we know we wrote.
 */
export function parseDraggedRef(raw: string): DraggedRef | null {
  if (raw === "") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { type?: unknown; name?: unknown; tagType?: unknown };
  if (
    (candidate.type !== "branch" && candidate.type !== "tag") ||
    typeof candidate.name !== "string" ||
    candidate.name === ""
  ) {
    return null;
  }
  const tagType = asTagType(typeof candidate.tagType === "string" ? candidate.tagType : undefined);
  return tagType === undefined
    ? { type: candidate.type, name: candidate.name }
    : { type: candidate.type, name: candidate.name, tagType };
}

/**
 * Decides what dropping `ref` on a commit may do, in menu order.
 *
 * A branch that is not checked out simply moves. The checked-out one cannot:
 * moving it would leave the working tree describing a commit HEAD no longer
 * names, so the two ways of actually taking the branch there are offered
 * instead -- reset it, or replay its commits onto the target. `HEAD` itself is
 * not a branch anyone can move or rebase, so a detached-HEAD badge offers
 * nothing.
 */
export function dropActionsFor(ref: DraggedRef, context: DropContext): DropActionKind[] {
  if (ref.type === "tag") {
    return ["moveTag"];
  }
  if (ref.name === "HEAD") {
    return [];
  }
  return ref.name === context.currentBranch ? ["resetHead", "rebase"] : ["moveBranch"];
}
