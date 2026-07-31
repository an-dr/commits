import { toolbarIcons } from "./utils/icons";

const MATCH_CLASS = "findMatch";
const CURRENT_CLASS = "findCurrentMatch";

/**
 * Searches the commit rows already rendered in the tab. The widget owns only
 * presentation state; repository refreshes can replace the table and then
 * call refresh() to reapply the active query.
 */
export class FindWidget {
  private readonly root: HTMLElement;
  private readonly table: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private matches: HTMLElement[] = [];
  private current = -1;

  constructor(table: HTMLElement) {
    this.table = table;
    this.root = document.getElementById("findWidget")!;
    this.input = document.getElementById("findInput") as HTMLInputElement;
    this.count = document.getElementById("findMatchCount")!;

    const findBtn = document.getElementById("findBtn")!;
    findBtn.innerHTML = toolbarIcons.search;
    findBtn.addEventListener("click", () => this.open());
    document.getElementById("findPreviousBtn")!.addEventListener("click", () => this.move(-1));
    document.getElementById("findNextBtn")!.addEventListener("click", () => this.move(1));
    document.getElementById("findCloseBtn")!.addEventListener("click", () => this.close());
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.move(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        this.open();
      } else if (event.key === "Escape" && this.isOpen()) {
        event.preventDefault();
        this.close();
      }
    });
  }

  public open() {
    this.root.classList.add("active");
    this.root.setAttribute("aria-hidden", "false");
    this.input.focus();
    this.input.select();
    this.refresh();
  }

  public close() {
    this.clearHighlights();
    this.input.value = "";
    this.matches = [];
    this.current = -1;
    this.updateCount();
    this.root.classList.remove("active");
    this.root.setAttribute("aria-hidden", "true");
  }

  public refresh() {
    const currentHash = this.current >= 0 ? this.matches[this.current]?.dataset.hash : undefined;
    this.clearHighlights();

    const query = this.input.value.trim().toLocaleLowerCase();
    if (query === "") {
      this.matches = [];
      this.current = -1;
      this.updateCount();
      return;
    }

    this.matches = Array.from(
      this.table.querySelectorAll<HTMLElement>("tr.commit:not(.filterHidden)")
    ).filter((row) =>
      (row.dataset.findText ?? row.textContent ?? "").toLocaleLowerCase().includes(query)
    );
    for (const row of this.matches) {
      row.classList.add(MATCH_CLASS);
    }

    const retained = this.matches.findIndex((row) => row.dataset.hash === currentHash);
    this.current = this.matches.length === 0 ? -1 : retained >= 0 ? retained : 0;
    this.showCurrent();
  }

  private isOpen() {
    return this.root.classList.contains("active");
  }

  private move(delta: -1 | 1) {
    if (this.matches.length === 0) {
      return;
    }
    this.matches[this.current]?.classList.remove(CURRENT_CLASS);
    this.current = (this.current + delta + this.matches.length) % this.matches.length;
    this.showCurrent();
  }

  private showCurrent() {
    if (this.current >= 0) {
      const row = this.matches[this.current];
      row.classList.add(CURRENT_CLASS);
      row.scrollIntoView?.({ block: "center" });
    }
    this.updateCount();
  }

  private clearHighlights() {
    for (const row of Array.from(
      this.table.querySelectorAll(`.${MATCH_CLASS}, .${CURRENT_CLASS}`)
    )) {
      row.classList.remove(MATCH_CLASS, CURRENT_CLASS);
    }
  }

  private updateCount() {
    this.count.textContent =
      this.matches.length === 0
        ? l10n.findNoMatches
        : l10n.findMatchCount
            .replace("{0}", String(this.current + 1))
            .replace("{1}", String(this.matches.length));
  }
}
