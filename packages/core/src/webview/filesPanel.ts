import { PanelBar } from "./panelBar";
import { toolbarIcons } from "./utils/icons";
import { clamp } from "./utils/math";

/** Narrowest and widest the panel may be dragged, in pixels. */
const MIN_WIDTH = 140;
const MAX_WIDTH = 600;

/** Width used until the user drags the panel. */
export const DEFAULT_FILES_PANEL_WIDTH = 280;

/**
 * Persistent side panel listing the files changed by the selected commit.
 *
 * The panel renders HTML it is given rather than a file tree, so the caller
 * owns how a change list is presented and this class stays layout-only.
 */
export class FilesPanel {
  private readonly panel: HTMLElement;
  private readonly bar: PanelBar;
  private readonly toggleBtn: HTMLElement;
  private readonly contentElem: HTMLElement;
  private readonly footerElem: HTMLElement;
  private panelHidden: boolean = true;
  private panelWidth: number;
  private scrollTop: number = 0;
  private onWidthChange: (width: number) => void;

  constructor(
    width: number,
    hidden: boolean,
    onWidthChange: (width: number) => void = () => {},
    private readonly onVisibilityChange: (hidden: boolean) => void = () => {}
  ) {
    this.panelWidth = clampWidth(width);
    this.panelHidden = hidden;
    this.onWidthChange = onWidthChange;
    this.panel = document.getElementById("filesPanel")!;

    const resizeHandle = document.createElement("div");
    resizeHandle.id = "filesPanelResizeHandle";
    this.panel.appendChild(resizeHandle);
    this.setupResize(resizeHandle);

    this.bar = new PanelBar(this.panel);
    this.bar.addCloseButton(() => this.setHidden(true));

    // The panel owns its toolbar toggle the way the branch panel owns its own,
    // so its visibility has exactly one source of truth.
    this.toggleBtn = document.getElementById("filesPanelToggleBtn")!;
    this.toggleBtn.innerHTML = toolbarIcons.filesPanel;
    this.toggleBtn.addEventListener("click", () => this.toggle());

    this.contentElem = document.createElement("div");
    this.contentElem.id = "filesPanelContent";
    this.panel.appendChild(this.contentElem);

    this.footerElem = document.createElement("div");
    this.footerElem.id = "filesPanelFooter";
    this.panel.appendChild(this.footerElem);

    this.contentElem.addEventListener("scroll", () => {
      this.scrollTop = this.contentElem.scrollTop;
    });

    // Opens as the user last left it: the panel is theirs to show or hide now,
    // rather than something a selection opens and a cleared selection closes.
    this.applyInlineWidth(this.panelWidth);
    this.applyLayout();
    this.showPlaceholder();
  }

  /** Drags the left edge, committing the new width only when the drag ends. */
  private setupResize(handle: HTMLElement) {
    let startX = 0;
    let startWidth = 0;
    const onMove = (e: MouseEvent) => {
      // The panel is on the right, so dragging left widens it.
      const width = clampWidth(startWidth - (e.clientX - startX));
      this.panelWidth = width;
      this.applyWidth(width);
      this.applyInlineWidth(width);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      this.onWidthChange(this.panelWidth);
    };
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = this.panelWidth;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  /** Width the rest of the layout reserves; zero while the panel is hidden. */
  private applyWidth(width: number) {
    document.body.style.setProperty("--files-panel-width", width + "px");
  }

  /** The panel's own width, kept while hidden so it reopens as the user left it. */
  private applyInlineWidth(width: number) {
    document.body.style.setProperty("--files-panel-inline-width", width + "px");
  }

  public toggle() {
    this.setHidden(!this.panelHidden);
  }

  private setHidden(hidden: boolean) {
    if (this.panelHidden === hidden) {
      return;
    }
    this.panelHidden = hidden;
    this.applyLayout();
    this.onVisibilityChange(hidden);
  }

  /** Paints the current visibility onto the body and the toolbar toggle. */
  private applyLayout() {
    document.body.classList.toggle("filesPanelHidden", this.panelHidden);
    this.applyWidth(this.panelHidden ? 0 : this.panelWidth);
    this.toggleBtn.classList.toggle("active", !this.panelHidden);
  }

  /** Replaces the file list, restoring the scroll position the user left. */
  public setContent(html: string) {
    this.contentElem.innerHTML = html;
    this.contentElem.scrollTop = this.scrollTop;
  }

  public setFooter(html: string) {
    this.footerElem.innerHTML = html;
    this.syncContentEdges();
  }

  public setContentLoading() {
    this.contentElem.innerHTML = `<div class="filesPanelPlaceholder">${l10n.loading}</div>`;
  }

  private showPlaceholder() {
    this.contentElem.innerHTML = `<div class="filesPanelPlaceholder">${l10n.filesPanelPlaceholder}</div>`;
  }

  /** Returns the panel to its no-commit-selected state. */
  public clear() {
    this.scrollTop = 0;
    this.footerElem.innerHTML = "";
    this.syncContentEdges();
    this.showPlaceholder();
  }

  public getContentElem(): HTMLElement {
    return this.contentElem;
  }

  /**
   * Insets the scrolling area by the footer height, which varies with its
   * content and so cannot be fixed in the stylesheet. There is no header any
   * more: content starts flush with the panel's top edge.
   */
  private syncContentEdges() {
    const footer = this.footerElem.offsetHeight;
    this.contentElem.style.bottom = footer > 0 ? footer + "px" : "";
  }
}

function clampWidth(width: number): number {
  return clamp(width, MIN_WIDTH, MAX_WIDTH);
}
