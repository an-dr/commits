import { showContextMenu } from "./contextMenu";
import { escapeHtml } from "./utils/html";
import { toolbarIcons } from "./utils/icons";

/** Marks a button the toolbar has folded away into the more menu. */
const OVERFLOW_HIDDEN = "overflowHidden";

/** The chevron half of a split button, which opens its menu instead of acting. */
const SPLIT_MENU = "splitBtnMenu";

export interface ToolbarButton {
  id: string;
  icon: string;
  title: string;
  /** False keeps the button out of the toolbar and out of the more menu. */
  visible: boolean;
  onClick: () => void;
  /**
   * Runs instead of a second onClick when the button is double-clicked, for a
   * button that carries a related pair of actions.
   */
  onDoubleClick?: () => void;
  /** Extra entries the more menu offers for this button. */
  overflowActions?: () => ContextMenuElement[];
  /**
   * Text shown beside the icon, which turns the button into a split button.
   *
   * The toolbar is icon-only otherwise, so a label is reserved for a button
   * whose icon cannot say which of several things it will do -- Open in names
   * the tool it would run.
   */
  label?: string;
  /** Entries the chevron half offers; without it there is no chevron. */
  menuActions?: () => ContextMenuElement[];
}

/**
 * A plain button is its icon; a labelled one is icon and text, with the
 * chevron in a part of its own so a click can tell the two halves apart.
 *
 * Exported because it is the whole of the split button's markup contract, and
 * the only part of the toolbar that can be checked without a browser.
 */
export function renderButtonContent(button: ToolbarButton): string {
  if (button.label === undefined) {
    return button.icon;
  }
  const main = `<span class="splitBtnMain">${button.icon}<span class="splitBtnLabel">${escapeHtml(button.label)}</span></span>`;
  return button.menuActions === undefined
    ? main
    : `${main}<span class="${SPLIT_MENU}">${toolbarIcons.chevronDown}</span>`;
}

/** Window within which a second click counts as a double click, in ms. */
const DOUBLE_CLICK_MS = 250;

/**
 * The order buttons give up their place as the toolbar narrows. Refresh goes
 * first because it is the most redundant, and reset last because it is the
 * hardest to find elsewhere. Matches the 2.0 collapse order.
 */
const COLLAPSE_ORDER = ["refreshBtn", "pushBtn", "pullBtn", "resetBtn"];

/**
 * The tab's top-right button group.
 *
 * Buttons are icon-only, so anything that cannot fit has to remain reachable:
 * the toolbar folds them into a more menu rather than clipping them, and
 * restores them as the tab widens again.
 */
export class Toolbar {
  private readonly controls: HTMLElement;
  private readonly left: HTMLElement;
  private readonly group: HTMLElement;
  private readonly moreBtn: HTMLElement;
  private buttons: ToolbarButton[] = [];
  /** Timer for a single-click action waiting out the double-click window. */
  private pendingClick: number | null = null;

  constructor() {
    this.controls = document.getElementById("controls")!;
    this.left = document.getElementById("controlsLeft")!;
    this.group = document.getElementById("controlsBtns")!;
    this.moreBtn = document.getElementById("moreBtn")!;
    this.moreBtn.innerHTML = toolbarIcons.more;
    this.moreBtn.addEventListener("click", (event) => {
      // Same reason as the split button's chevron: the document-level closer
      // would otherwise receive this very click and shut the menu at once.
      event.stopPropagation();
      this.showOverflowMenu(event);
    });
    // Delegated so that re-declaring the button set cannot stack up listeners.
    this.group.addEventListener("click", (event) => {
      const elem = (event.target as Element).closest<HTMLElement>(".iconBtn");
      const button = this.buttons.find((candidate) => candidate.id === elem?.id);
      if (button === undefined || !button.visible) {
        return;
      }
      // The chevron half never runs the button's own action: it exists so the
      // other tools can be reached without changing which one is default.
      if (button.menuActions !== undefined && (event.target as Element).closest(`.${SPLIT_MENU}`) !== null) {
        // The document closes any open menu on click, so the click that opens
        // this one must stop here or it would shut it again on the way up.
        event.stopPropagation();
        showContextMenu(event, button.menuActions(), elem!);
        return;
      }
      if (button.onDoubleClick === undefined) {
        button.onClick();
        return;
      }
      // A button carrying two actions cannot run the first one immediately, or
      // a double click would run both. The single-click action waits out the
      // double-click window instead.
      if (this.pendingClick !== null) {
        window.clearTimeout(this.pendingClick);
        this.pendingClick = null;
        button.onDoubleClick();
        return;
      }
      this.pendingClick = window.setTimeout(() => {
        this.pendingClick = null;
        button.onClick();
      }, DOUBLE_CLICK_MS);
    });
    this.group.addEventListener("contextmenu", (event) => {
      const elem = (event.target as Element).closest<HTMLElement>(".iconBtn");
      const button = this.buttons.find((candidate) => candidate.id === elem?.id);
      if (button === undefined || !button.visible || button.overflowActions === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event, button.overflowActions(), elem!);
    });
    this.observeContainerWidth();
  }

  /**
   * `applyLayout()` used to re-run only on a real OS window resize, but the
   * files panel and the branch panel both change how much width `#controls`
   * actually has via CSS variables, with no window resize involved -- the
   * toolbar's fitted button set went stale, and buttons crowded or shifted
   * instead of folding into the more menu. A `ResizeObserver` on `#controls`
   * itself catches every case uniformly (window resize included) rather than
   * only the ones some other code remembers to call `refresh()` for.
   *
   * Safe from the feedback loop a naive version of this can fall into
   * (compare `--top-bar-height`'s own fix): `applyLayout()` only toggles
   * `display: none` on individual buttons, which cannot change `#controls`'
   * own width -- that width comes from its flex parent, not its content.
   * The width comparison below is a second, independent guard regardless.
   */
  private observeContainerWidth() {
    let lastWidth = -1;
    const sync = () => {
      const width = Math.round(this.controls.getBoundingClientRect().width);
      if (width === lastWidth) {
        return;
      }
      lastWidth = width;
      this.applyLayout();
    };
    new ResizeObserver(sync).observe(this.controls);
  }

  /** Installs the button set, replacing any previous one. */
  public setButtons(buttons: readonly ToolbarButton[]) {
    this.buttons = [...buttons];
    for (const button of this.buttons) {
      const elem = this.findElem(button.id);
      if (elem === null) {
        continue;
      }
      elem.innerHTML = renderButtonContent(button);
      elem.classList.toggle("splitBtn", button.label !== undefined);
      elem.title = button.title;
    }
    this.applyLayout();
  }

  /** Re-reads visibility and re-runs the fit, after repository state changes. */
  public refresh() {
    this.applyLayout();
  }

  private findElem(id: string): HTMLElement | null {
    return document.getElementById(id);
  }

  /** True while the two control groups have run out of room between them. */
  private isOverflowing(): boolean {
    if (this.controls.clientWidth <= 0) {
      return false;
    }
    const leftEdge = this.left.getBoundingClientRect().right;
    const groupEdge = this.group.getBoundingClientRect().left;
    return this.controls.scrollWidth > this.controls.clientWidth || leftEdge >= groupEdge - 1;
  }

  /**
   * Shows every visible button, then hides them in the collapse order until the
   * row fits. Recomputed from scratch so widening the tab restores buttons.
   */
  private applyLayout() {
    for (const button of this.buttons) {
      this.findElem(button.id)?.classList.toggle(OVERFLOW_HIDDEN, !button.visible);
    }
    this.moreBtn.classList.add(OVERFLOW_HIDDEN);

    for (const id of COLLAPSE_ORDER) {
      if (!this.isOverflowing()) {
        break;
      }
      const button = this.buttons.find((candidate) => candidate.id === id);
      const elem = button?.visible === true ? this.findElem(id) : null;
      if (elem === null || elem.classList.contains(OVERFLOW_HIDDEN)) {
        continue;
      }
      elem.classList.add(OVERFLOW_HIDDEN);
      this.moreBtn.classList.remove(OVERFLOW_HIDDEN);
    }
  }

  /** Everything currently folded away, in toolbar order. */
  private getHiddenButtons(): ToolbarButton[] {
    return this.buttons.filter(
      (button) =>
        button.visible && this.findElem(button.id)?.classList.contains(OVERFLOW_HIDDEN) === true
    );
  }

  private showOverflowMenu(event: MouseEvent) {
    const hidden = this.getHiddenButtons();
    if (hidden.length === 0) {
      return;
    }
    const menu: ContextMenuElement[] = [];
    for (const button of hidden) {
      if (menu.length > 0) {
        menu.push(null);
      }
      menu.push(
        ...(button.overflowActions?.() ?? [{ title: button.title, onClick: button.onClick }])
      );
    }
    showContextMenu(event, menu, this.moreBtn);
  }
}
