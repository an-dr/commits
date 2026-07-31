import type { FullDiffData, FullDiffViewMode } from "./fullDiffRender";
import { renderFullDiff } from "./fullDiffRender";
import { escapeHtml } from "./utils/html";
import { clamp } from "./utils/math";

/** Shortest and tallest the panel may be dragged, in pixels. */
const MIN_HEIGHT = 80;
const MAX_VIEWPORT_REMAINDER = 100;

/** Height used until the user drags the panel. */
export const DEFAULT_FULL_DIFF_HEIGHT = 260;

/** Scroll offset kept above a change so it does not sit against the top edge. */
const NAV_MARGIN = 4;

const VIEW_MODES: readonly FullDiffViewMode[] = ["unified", "sideBySide", "raw"];

/**
 * Which file was open is not persisted: after a reload no commit is expanded,
 * so there would be nothing to show.
 */
export interface FullDiffPanelState {
  height: number;
  mode: FullDiffViewMode;
  compact: boolean;
}

/**
 * Bottom-docked panel showing one file's contents with its changes marked.
 *
 * The panel is closed until a file is picked, and reserves its height through
 * a CSS variable so the rest of the layout insets itself rather than needing
 * every neighbouring element repositioned from script.
 */
export class FullDiffPanel {
  private readonly panel: HTMLElement;
  private readonly filenameElem: HTMLElement;
  private readonly contentElem: HTMLElement;
  private readonly counterElem: HTMLElement;
  private readonly compactBtn: HTMLElement;
  private readonly onStateChange: (state: FullDiffPanelState) => void;
  private height: number;
  private mode: FullDiffViewMode;
  private compact: boolean;
  private hidden = true;
  private data: FullDiffData | null = null;
  private changes: HTMLElement[] = [];
  private changeIndex = 0;
  private scrollListenerElem: HTMLElement | null = null;
  private readonly onScroll = () => this.syncChangeIndexToScroll();

  constructor(
    state: Partial<FullDiffPanelState> | undefined,
    onStateChange: (state: FullDiffPanelState) => void = () => {}
  ) {
    this.panel = document.getElementById("fullDiffPanel")!;
    this.filenameElem = document.getElementById("fullDiffFilename")!;
    this.contentElem = document.getElementById("fullDiffContent")!;
    this.counterElem = document.getElementById("fullDiffChangeCounter")!;
    this.compactBtn = document.getElementById("fullDiffCompactBtn")!;
    this.onStateChange = onStateChange;
    this.height = clampHeight(state?.height ?? DEFAULT_FULL_DIFF_HEIGHT);
    // The mode is erased over the saved-state boundary, so an unrecognised
    // value falls back rather than rendering nothing.
    this.mode = VIEW_MODES.includes(state?.mode as FullDiffViewMode)
      ? (state!.mode as FullDiffViewMode)
      : "unified";
    this.compact = state?.compact === true;

    document.getElementById("fullDiffCloseBtn")!.addEventListener("click", () => this.close());
    document
      .getElementById("fullDiffPrevChangeBtn")!
      .addEventListener("click", () => this.moveToChange(-1));
    document
      .getElementById("fullDiffNextChangeBtn")!
      .addEventListener("click", () => this.moveToChange(1));
    this.compactBtn.addEventListener("click", () => {
      this.compact = !this.compact;
      this.rerender();
      this.onStateChange(this.getState());
    });
    for (const mode of VIEW_MODES) {
      document
        .getElementById(`fullDiffMode-${mode}`)!
        .addEventListener("click", () => this.setMode(mode));
    }
    this.setupResize(document.getElementById("fullDiffResizeHandle")!);
    this.applyLayout();
    this.renderControls();
  }

  public getState(): FullDiffPanelState {
    return { height: this.height, mode: this.mode, compact: this.compact };
  }

  /** Opens the panel for a file and shows the loading state until data arrives. */
  public open(filePath: string) {
    this.hidden = false;
    this.data = null;
    this.filenameElem.textContent = filePath;
    this.contentElem.innerHTML = `<div class="fullDiffMessage">${escapeHtml(l10n.loading)}</div>`;
    this.collectChanges();
    this.applyLayout();
    this.onStateChange(this.getState());
  }

  public close() {
    if (this.hidden) {
      return;
    }
    this.hidden = true;
    this.data = null;
    this.contentElem.innerHTML = "";
    this.collectChanges();
    this.applyLayout();
    this.onStateChange(this.getState());
  }

  public isHidden(): boolean {
    return this.hidden;
  }

  /** Replaces the body with the rendered file, or with a failure message. */
  public render(data: FullDiffData | null) {
    if (this.hidden) {
      return;
    }
    this.data = data;
    this.contentElem.innerHTML = renderFullDiff(data, { mode: this.mode, compact: this.compact });
    this.contentElem.scrollTop = 0;
    this.syncSideBySideScrolling();
    this.collectChanges();
  }

  private setMode(mode: FullDiffViewMode) {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.rerender();
    this.onStateChange(this.getState());
  }

  /** Redraws from the data already held, for a control that changes only presentation. */
  private rerender() {
    this.renderControls();
    if (!this.hidden && this.data !== null) {
      this.render(this.data);
    }
  }

  private renderControls() {
    for (const mode of VIEW_MODES) {
      document
        .getElementById(`fullDiffMode-${mode}`)!
        .classList.toggle("active", mode === this.mode);
    }
    this.compactBtn.classList.toggle("active", this.compact);
  }

  /** Keeps the two side-by-side panes lined up while either one is scrolled. */
  private syncSideBySideScrolling() {
    const panes = Array.from(this.contentElem.querySelectorAll<HTMLElement>(".diffSbsPane"));
    if (panes.length !== 2) {
      return;
    }
    let syncing = false;
    for (const [index, pane] of panes.entries()) {
      pane.addEventListener("scroll", () => {
        if (syncing) {
          return;
        }
        syncing = true;
        panes[index === 0 ? 1 : 0].scrollTop = pane.scrollTop;
        syncing = false;
      });
    }
  }

  /** The scrolling element, which is a pane of its own in side-by-side mode. */
  private getScrollElem(): HTMLElement {
    return this.contentElem.querySelector<HTMLElement>(".diffSbsPaneOld") ?? this.contentElem;
  }

  /**
   * Re-reads the changed blocks after a render, and moves the scroll listener
   * onto whichever element now scrolls — in side-by-side mode that element is
   * replaced on every render.
   */
  private collectChanges() {
    this.changes = Array.from(this.contentElem.querySelectorAll<HTMLElement>(".diffChangedBlock"));
    this.changeIndex = 0;
    this.scrollListenerElem?.removeEventListener("scroll", this.onScroll);
    this.scrollListenerElem = this.getScrollElem();
    this.scrollListenerElem.addEventListener("scroll", this.onScroll);
    this.updateCounter();
  }

  /** Reports the change the view is currently showing, as the user scrolls. */
  private syncChangeIndexToScroll() {
    const scrollTop = this.getScrollElem().scrollTop + NAV_MARGIN;
    let current = 0;
    for (let i = 0; i < this.changes.length; i++) {
      if (this.changes[i].offsetTop > scrollTop) {
        break;
      }
      current = i;
    }
    this.changeIndex = current;
    this.updateCounter();
  }

  private moveToChange(delta: -1 | 1) {
    if (this.changes.length === 0) {
      return;
    }
    this.changeIndex = clamp(this.changeIndex + delta, 0, this.changes.length - 1);
    this.getScrollElem().scrollTop = this.changes[this.changeIndex].offsetTop - NAV_MARGIN;
    this.updateCounter();
  }

  private updateCounter() {
    this.counterElem.textContent = l10n.fullDiffChangeCount
      .replace("{0}", String(this.changes.length === 0 ? 0 : this.changeIndex + 1))
      .replace("{1}", String(this.changes.length));
  }

  private applyLayout() {
    document.body.classList.toggle("fullDiffPanelHidden", this.hidden);
    document.body.style.setProperty("--full-diff-height", `${this.hidden ? 0 : this.height}px`);
    this.panel.style.height = `${this.height}px`;
  }

  /** Drags the top edge; the new height is persisted only when the drag ends. */
  private setupResize(handle: HTMLElement) {
    const onMove = (event: MouseEvent) => {
      // The panel is docked to the bottom, so dragging up makes it taller.
      this.height = clampHeight(window.innerHeight - event.clientY);
      this.applyLayout();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      this.onStateChange(this.getState());
    };
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
}

function clampHeight(height: number): number {
  // A very short viewport can push the upper bound below the lower one, so the
  // maximum is itself held at or above the minimum before clamping.
  return clamp(
    height,
    MIN_HEIGHT,
    Math.max(MIN_HEIGHT, window.innerHeight - MAX_VIEWPORT_REMAINDER)
  );
}
