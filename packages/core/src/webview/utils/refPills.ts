import { escapeHtml } from "./html";

/** Rendering variants for a tag badge. */
export interface RenderTagPillOptions {
  /**
   * Collapse to the tighter form, where space is short. The badge keeps its
   * name: the shape is what says "tag" now, and a badge with the icon removed
   * and the name dropped would be an empty sliver.
   */
  compact?: boolean;
  /** "annotated" or "lightweight", emitted as data-tagtype when known. */
  tagType?: string;
  /** Whether the badge can be dragged onto a commit row. */
  draggable?: boolean;
  /** Overrides the default "Tag: <name>" tooltip. */
  title?: string;
}

/**
 * Renders one tag reference badge.
 *
 * The `.gitRef.tag` markup contract is shared by every surface that shows tag
 * badges, so it lives in one place rather than being repeated per view.
 *
 * A tag carries no icon: `.gitRef.tag` is cut to a pennant with a pointed left
 * edge, so its shape distinguishes it from a branch's rectangle. That leaves
 * the one icon in the graph meaning exactly one thing -- the branch HEAD is on.
 */
export function renderTagPill(name: string, options: RenderTagPillOptions = {}): string {
  const escapedName = escapeHtml(name);
  const title = escapeHtml(options.title ?? `Tag: ${name}`);
  const tagTypeAttr = options.tagType ? ` data-tagtype="${options.tagType}"` : "";
  const draggableAttr = options.draggable ? ' draggable="true"' : "";
  return (
    `<span class="gitRef tag${options.compact ? " compact" : ""}" data-name="${escapedName}"` +
    `${tagTypeAttr} data-drag-ref-type="tag" data-drag-ref-name="${escapedName}"` +
    `${draggableAttr} title="${title}">` +
    `<span class="gitRefName" data-fullref="${escapedName}">${escapedName}</span></span>`
  );
}

// The old tree also had renderTagOverflowPill, the compact "+N" badge for
// tags collapsed for space. Its only caller is the sidebar's mini graph,
// which staging does not have yet, so it is deliberately not converted here
// rather than landing as an export nothing reaches. It comes back with the
// sidebar in backlog 5 group A.
