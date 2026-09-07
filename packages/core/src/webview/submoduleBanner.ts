import type { SubmoduleState, SubmoduleView } from "../types";
import { escapeHtml } from "./utils/html";

/** How many paths the banner names before it counts the rest. */
const LISTED_PATHS = 4;

/** How the state reads at the end of a listed path. */
export function stateLabel(state: SubmoduleState): string {
  switch (state) {
    case "uninitialized":
      return l10n.submodulesUninitialized;
    case "outOfDate":
      return l10n.submodulesOutOfDate;
    case "conflicted":
      return l10n.submodulesConflicted;
    case "upToDate":
      return l10n.submodulesUpToDate;
  }
}

/** Every submodule whose checkout does not match the recorded commit. */
export function pending(submodules: readonly SubmoduleView[]): readonly SubmoduleView[] {
  return submodules.filter((submodule) => submodule.state !== "upToDate");
}

/**
 * The banner's second line: the paths themselves, because a count alone
 * cannot be acted on, and a repository with twenty submodules must not push
 * the graph off the screen to say so.
 */
export function formatPaths(submodules: readonly SubmoduleView[]): string {
  const listed = submodules
    .slice(0, LISTED_PATHS)
    .map((submodule) => `${submodule.path} (${stateLabel(submodule.state)})`);
  if (submodules.length > LISTED_PATHS) {
    listed.push(l10n.submodulesMore.replace("{0}", String(submodules.length - LISTED_PATHS)));
  }
  return listed.join(", ");
}

/**
 * A signature of what the banner is reporting, so a dismissal lasts exactly as
 * long as the situation it was aimed at.
 *
 * Dismissing "vendor/bones is out of date" must not also silence the
 * submodule added tomorrow -- the whole point of the banner is that a
 * submodule never goes unnoticed.
 */
export function signature(repo: string, submodules: readonly SubmoduleView[]): string {
  return [repo, ...submodules.map((submodule) => `${submodule.path}:${submodule.state}`)].join("\n");
}

/**
 * Banner shown above the commit table while the open repository has
 * submodules that are not checked out at the commit it records.
 *
 * It is the only place in the view that reports this, and it carries the one
 * command that fixes all of it at once, so the state and its remedy are never
 * more than one click apart. Dismissal is remembered per situation rather than
 * per repository: a banner the user has answered stays down, and a submodule
 * that changes afterwards raises it again.
 */
export class SubmoduleBanner {
  private readonly banner: HTMLElement;
  private readonly primaryElem: HTMLElement;
  private readonly secondaryElem: HTMLElement;
  private readonly actionsElem: HTMLElement;
  private readonly updateButton: HTMLButtonElement;
  private readonly dismissButton: HTMLButtonElement;
  private dismissed: string | null = null;
  private current = "";
  private updating = false;

  constructor(private readonly onUpdate: () => void) {
    this.banner = document.getElementById("submoduleBanner")!;
    this.primaryElem = document.createElement("div");
    this.primaryElem.id = "submoduleBannerPrimary";
    this.secondaryElem = document.createElement("div");
    this.secondaryElem.id = "submoduleBannerSecondary";
    this.actionsElem = document.createElement("div");
    this.actionsElem.id = "submoduleBannerActions";
    this.updateButton = document.createElement("button");
    this.updateButton.className = "roundedBtn";
    this.updateButton.textContent = l10n.submodulesUpdate;
    this.updateButton.addEventListener("click", () => {
      if (!this.updating) this.onUpdate();
    });
    this.dismissButton = document.createElement("button");
    this.dismissButton.className = "roundedBtn secondary";
    this.dismissButton.textContent = l10n.submodulesDismiss;
    this.dismissButton.addEventListener("click", () => {
      this.dismissed = this.current;
      this.hide();
    });
    this.actionsElem.appendChild(this.updateButton);
    this.actionsElem.appendChild(this.dismissButton);
    this.banner.appendChild(this.primaryElem);
    this.banner.appendChild(this.secondaryElem);
    this.banner.appendChild(this.actionsElem);
  }

  public render(repo: string, submodules: readonly SubmoduleView[]) {
    const outstanding = pending(submodules);
    this.current = signature(repo, outstanding);
    if (outstanding.length === 0) {
      // Nothing left to answer, so an old dismissal has nothing to suppress
      // and would only mute the next situation it happens to match.
      this.dismissed = null;
      this.setUpdating(false);
      this.hide();
      return;
    }
    if (this.dismissed === this.current && !this.updating) {
      this.hide();
      return;
    }
    const count = outstanding.length;
    this.primaryElem.innerHTML =
      count === 1
        ? l10n.submodulesOne
        : l10n.submodulesPrimary.replace("{0}", `<b>${escapeHtml(String(count))}</b>`);
    // Set as text, not markup: these paths come out of the repository.
    this.secondaryElem.textContent = formatPaths(outstanding);
    this.banner.classList.toggle(
      "conflicted",
      outstanding.some((submodule) => submodule.state === "conflicted")
    );
    this.banner.classList.add("active");
  }

  /** Reflects a running `submodule update`, which can take a clone's worth of time. */
  public setUpdating(updating: boolean) {
    this.updating = updating;
    this.updateButton.disabled = updating;
    this.dismissButton.disabled = updating;
    this.updateButton.textContent = updating ? l10n.submodulesUpdating : l10n.submodulesUpdate;
    this.banner.classList.toggle("updating", updating);
  }

  private hide() {
    this.banner.classList.remove("active", "conflicted");
    this.primaryElem.textContent = "";
    this.secondaryElem.textContent = "";
  }
}
