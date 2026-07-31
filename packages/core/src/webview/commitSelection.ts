/** How a click asked the selection to change. */
export type SelectionGesture = "replace" | "toggle" | "range";

/**
 * Reads the gesture out of a mouse event, using the platform's own conventions:
 * Ctrl (Cmd on macOS) adds or removes one commit, Shift extends from the last
 * one touched, and a plain click replaces the selection.
 */
export function readSelectionGesture(event: MouseEvent): SelectionGesture {
  if (event.shiftKey) {
    return "range";
  }
  return event.ctrlKey || event.metaKey ? "toggle" : "replace";
}

/**
 * Which commits the user has picked out of the table.
 *
 * Held apart from the view so the rules stay testable without a DOM: the table
 * only asks what is selected and paints accordingly.
 */
export class CommitSelection {
  private selected = new Set<string>();
  /** Anchor a range gesture extends from; -1 before anything is picked. */
  private lastIndex = -1;

  public getSelected(): string[] {
    return [...this.selected];
  }

  public size(): number {
    return this.selected.size;
  }

  public has(hash: string): boolean {
    return this.selected.has(hash);
  }

  public clear() {
    this.selected.clear();
    this.lastIndex = -1;
  }

  /**
   * Applies a gesture and reports the resulting selection.
   * @param hashes Every commit hash in table order, so a range can be resolved.
   */
  public apply(gesture: SelectionGesture, index: number, hashes: readonly string[]): string[] {
    const hash = hashes[index];
    if (hash === undefined) {
      return this.getSelected();
    }
    switch (gesture) {
      case "replace":
        this.selected = new Set([hash]);
        break;
      case "toggle":
        if (this.selected.has(hash)) {
          this.selected.delete(hash);
        } else {
          this.selected.add(hash);
        }
        break;
      case "range": {
        // With no anchor yet a range behaves like picking that one commit.
        const from = this.lastIndex >= 0 ? this.lastIndex : index;
        for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
          if (hashes[i] !== undefined) {
            this.selected.add(hashes[i]);
          }
        }
        break;
      }
    }
    this.lastIndex = index;
    return this.getSelected();
  }

  /**
   * The two selected commits ordered oldest-first, or null unless exactly two
   * are selected. Table order runs newest-first, so the later index is older.
   */
  public getComparison(hashes: readonly string[]): { from: string; to: string } | null {
    if (this.selected.size !== 2) {
      return null;
    }
    const picked = this.getSelected();
    const first = hashes.indexOf(picked[0]);
    const second = hashes.indexOf(picked[1]);
    if (first < 0 || second < 0) {
      return null;
    }
    return first > second ? { from: picked[0], to: picked[1] } : { from: picked[1], to: picked[0] };
  }
}
