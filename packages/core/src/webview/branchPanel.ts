import { renderBranchPanel } from "./branchPanelRender";
import { toolbarIcons } from "./utils/icons";
import { clamp } from "./utils/math";

export const DEFAULT_BRANCH_PANEL_WIDTH = 220;

/** Narrowest and widest the panel may be dragged, in pixels. */
const MIN_WIDTH = 140;
const MAX_WIDTH = 600;

export interface BranchPanelState {
  hidden: boolean;
  width: number;
}

export interface BranchPanelRenderOption {
  name: string;
  value: string;
  selected: boolean;
  current: boolean;
}

/** What HEAD points at, named the way a Git client's branch panel names it. */
export interface BranchPanelHead {
  /** Checked-out branch, or null while HEAD is detached. */
  branch: string | null;
  /** Commit HEAD resolves to, shown abbreviated beside the row. */
  hash: string | null;
}

/** What the host knows about where refs come from and where they go. */
export interface BranchPanelRemoteInfo {
  /** Upstream of each local branch that tracks one, by branch name. */
  upstreams: Readonly<Record<string, string>>;
  /** Fetch URL of each remote, by remote name. */
  remotes: Readonly<Record<string, string>>;
}

export const NO_REMOTE_INFO: BranchPanelRemoteInfo = { upstreams: {}, remotes: {} };

export interface BranchPanelRenderModel {
  options: readonly BranchPanelRenderOption[];
  head: BranchPanelHead;
  remoteInfo: BranchPanelRemoteInfo;
  filter: string;
  collapsedFolders: ReadonlySet<string>;
  /** Sorts folders above plain refs; matches `branchPanel.groupsFirst`. */
  groupsFirst: boolean;
  /** Collapses a chain of single-child folders into one row. */
  flattenSingleChildGroups: boolean;
}

/** Owns the branch sidebar layout; behavior is added separately. */
export class BranchPanel {
  private readonly list: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly toggle: HTMLElement;
  private readonly onLayoutChange: (state: BranchPanelState) => void;
  private readonly onSelect: (value: string, additive: boolean) => void;
  private readonly onAction: (
    value: string,
    kind: "doubleClick" | "contextMenu",
    source: HTMLElement,
    event: MouseEvent
  ) => void;
  private width: number;
  private hidden: boolean;
  private filter = "";
  private readonly collapsedFolders = new Set<string>();
  private options: BranchPanelRenderOption[] = [];
  private head: BranchPanelHead = { branch: null, hash: null };
  private remoteInfo: BranchPanelRemoteInfo = NO_REMOTE_INFO;

  constructor(
    state: Partial<BranchPanelState> | undefined,
    onLayoutChange: (state: BranchPanelState) => void,
    onSelect: (value: string, additive: boolean) => void,
    onAction: (
      value: string,
      kind: "doubleClick" | "contextMenu",
      source: HTMLElement,
      event: MouseEvent
    ) => void
  ) {
    this.sidebar = document.getElementById("branchPanelSidebar")!;
    this.list = document.getElementById("branchPanel")!;
    this.toggle = document.getElementById("sidebarToggleBtn")!;
    this.onLayoutChange = onLayoutChange;
    this.onSelect = onSelect;
    this.onAction = onAction;
    this.width = state?.width ?? DEFAULT_BRANCH_PANEL_WIDTH;
    this.hidden = state?.hidden ?? false;

    this.toggle.innerHTML = toolbarIcons.sidebar;
    this.toggle.addEventListener("click", () => this.setHidden(!this.hidden));
    this.setupResize(document.getElementById("branchPanelResizeHandle")!);
    this.setupBehavior();
    this.applyLayout(false);
  }

  public setOptions(
    options: readonly { name: string; value: string }[],
    selected: string | readonly string[]
  ) {
    const chosen = typeof selected === "string" ? [selected] : selected;
    this.options = options.map((option) => ({
      ...option,
      selected: chosen.indexOf(option.value) > -1,
      current: false
    }));
    this.render();
  }

  /** Records tracking and remote data; a host that sends none keeps the plain panel. */
  public setRemoteInfo(info: BranchPanelRemoteInfo) {
    this.remoteInfo = info;
    this.render();
  }

  /** Names the checked-out branch and the revision it resolves to. */
  public setHead(branch: string | null, hash: string | null) {
    this.head = { branch, hash };
    for (const option of this.options) {
      option.current = option.value === branch;
    }
    this.render();
  }

  /** Marks exactly the given values as selected. */
  public setSelectedValues(values: readonly string[]) {
    for (const option of this.options) {
      option.selected = values.indexOf(option.value) > -1;
    }
    this.render();
  }

  public setSelected(value: string) {
    for (const option of this.options) {
      option.selected = option.value === value;
    }
    this.render();
  }

  public getState(): BranchPanelState {
    return { hidden: this.hidden, width: this.width };
  }

  private setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.applyLayout();
  }

  private applyLayout(notify = true) {
    document.body.classList.toggle("branchPanelHidden", this.hidden);
    document.body.style.setProperty("--branch-panel-width", `${this.hidden ? 0 : this.width}px`);
    this.sidebar.style.width = `${this.width}px`;
    this.toggle.classList.toggle("active", !this.hidden);
    if (notify) {
      this.onLayoutChange(this.getState());
    }
  }

  private setupResize(handle: HTMLElement) {
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = this.width;
      const move = (moveEvent: MouseEvent) => {
        this.width = clamp(startWidth + moveEvent.clientX - startX, MIN_WIDTH, MAX_WIDTH);
        this.applyLayout(false);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        this.onLayoutChange(this.getState());
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  private setupBehavior() {
    const filter = document.createElement("input");
    filter.className = "branchPanelFilterInput";
    filter.type = "search";
    filter.placeholder = l10n.filterPlaceholder.replace("{0}", l10n.branch);
    filter.addEventListener("input", () => {
      this.filter = filter.value;
      this.render();
    });
    filter.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        filter.value = "";
        this.filter = "";
        this.render();
      }
    });
    this.sidebar.insertBefore(filter, this.list);

    this.list.addEventListener("click", (event) => {
      const folder = (event.target as Element).closest<HTMLElement>(".branchPanelFolder");
      if (folder?.dataset.folder !== undefined) {
        if (this.collapsedFolders.has(folder.dataset.folder)) {
          this.collapsedFolders.delete(folder.dataset.folder);
        } else {
          this.collapsedFolders.add(folder.dataset.folder);
        }
        this.render();
        return;
      }
      const item = (event.target as Element).closest<HTMLElement>(".branchPanelItem");
      if (item?.dataset.value === undefined) {
        return;
      }
      // Ctrl (or Cmd) adds to or removes from the selection; a plain click
      // replaces it. The checkbox is what it looks like, so hitting the box
      // adds or removes without the modifier.
      const onCheck = (event.target as Element).closest(".branchPanelCheck") !== null;
      const additive = onCheck || event.ctrlKey || event.metaKey;
      this.onSelect(item.dataset.value, additive);
    });
    this.list.addEventListener("dblclick", (event) => this.dispatchAction(event, "doubleClick"));
    this.list.addEventListener("contextmenu", (event) => this.dispatchAction(event, "contextMenu"));
  }

  private dispatchAction(event: MouseEvent, kind: "doubleClick" | "contextMenu") {
    const item = (event.target as Element).closest<HTMLElement>(".branchPanelItem");
    if (item?.dataset.value === undefined || item.dataset.value === "") {
      return;
    }
    event.stopPropagation();
    this.onAction(item.dataset.value, kind, item, event);
  }

  private render() {
    this.list.innerHTML = renderBranchPanel({
      options: this.options,
      head: this.head,
      remoteInfo: this.remoteInfo,
      filter: this.filter,
      collapsedFolders: this.collapsedFolders,
      groupsFirst: viewState.branchPanelGroupsFirst,
      flattenSingleChildGroups: viewState.branchPanelFlattenSingleChildGroups
    });
  }
}
