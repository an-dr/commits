import type {
  RepoInProgressState,
  RepoInProgressType,
  WorkingTreeStatus
} from "@an-dr/commits-core/backend/queries/repoInProgress";

import { escapeHtml } from "./utils/html";

/** How the operation is named in the banner heading. */
function stateLabel(type: RepoInProgressType): string {
  switch (type) {
    case "rebase":
      return l10n.repoInProgressRebase;
    case "merge":
      return l10n.repoInProgressMerge;
    case "cherry-pick":
      return l10n.repoInProgressCherryPick;
    case "revert":
      return l10n.repoInProgressRevert;
  }
}

/** Summarises the working tree, or reports it clean when nothing is pending. */
function formatWorkingTree(status: WorkingTreeStatus | null): string {
  if (status === null) {
    return l10n.repoInProgressWorkingTree;
  }
  const parts: string[] = [];
  if (status.changed > 0) {
    parts.push(l10n.repoInProgressChanged.replace("{0}", String(status.changed)));
  }
  if (status.staged > 0) {
    parts.push(l10n.repoInProgressStaged.replace("{0}", String(status.staged)));
  }
  if (status.conflicts > 0) {
    parts.push(l10n.repoInProgressConflicts.replace("{0}", String(status.conflicts)));
  }
  if (status.untracked > 0) {
    parts.push(l10n.repoInProgressUntracked.replace("{0}", String(status.untracked)));
  }
  const summary = parts.length > 0 ? parts.join(", ") : l10n.repoInProgressClean;
  return `${l10n.repoInProgressWorkingTree} (${summary})`;
}

/** The secondary line: working tree, what is being rebased, and the subject. */
export function formatSecondaryLine(state: RepoInProgressState): string {
  let secondary = formatWorkingTree(state.workingTreeStatus);
  const context = state.rebaseContext;
  if (context !== null) {
    if (context.branch !== null && context.onto !== null) {
      secondary += `, ${l10n.repoInProgressRebasingOnto
        .replace("{0}", context.branch)
        .replace("{1}", context.onto)}`;
    } else if (context.branch !== null) {
      secondary += `, ${l10n.repoInProgressRebasing.replace("{0}", context.branch)}`;
    } else if (context.onto !== null) {
      secondary += `, ${l10n.repoInProgressRebasingOntoOnly.replace("{0}", context.onto)}`;
    }
  }
  if (state.subject !== null) {
    secondary += `, ${stateLabel(state.type).toLowerCase()}: ${state.subject}`;
  }
  return secondary;
}

/**
 * Banner shown above the commit table while the repository is part-way
 * through a rebase, merge, cherry-pick, or revert.
 *
 * It is informational: the actions that would continue or abort the operation
 * are not implemented yet, so no button is offered that would do nothing.
 */
export class RepoInProgressBanner {
  private readonly banner: HTMLElement;
  private readonly primaryElem: HTMLElement;
  private readonly secondaryElem: HTMLElement;
  private readonly actionsElem: HTMLElement;
  private currentType: RepoInProgressType | null = null;

  constructor(
    onAction: (type: RepoInProgressType, action: "continue" | "abort") => void = () => {}
  ) {
    this.banner = document.getElementById("repoInProgressBanner")!;
    this.primaryElem = document.createElement("div");
    this.primaryElem.id = "repoInProgressBannerPrimary";
    this.secondaryElem = document.createElement("div");
    this.secondaryElem.id = "repoInProgressBannerSecondary";
    this.actionsElem = document.createElement("div");
    this.actionsElem.id = "repoInProgressBannerActions";
    for (const action of ["continue", "abort"] as const) {
      const button = document.createElement("button");
      button.className = "roundedBtn";
      button.dataset.action = action;
      button.textContent =
        action === "continue" ? l10n.repoInProgressContinue : l10n.repoInProgressAbort;
      button.addEventListener("click", () => {
        if (this.currentType !== null) {
          onAction(this.currentType, action);
        }
      });
      this.actionsElem.appendChild(button);
    }
    this.banner.appendChild(this.primaryElem);
    this.banner.appendChild(this.secondaryElem);
    this.banner.appendChild(this.actionsElem);
  }

  public render(state: RepoInProgressState | null) {
    if (state === null) {
      this.banner.classList.remove("active", "conflicted");
      this.primaryElem.textContent = "";
      this.secondaryElem.textContent = "";
      this.currentType = null;
      return;
    }

    const progress = state.rebaseProgress;
    const label =
      stateLabel(state.type) +
      (progress !== null ? ` (${progress.current}/${progress.total})` : "");
    this.primaryElem.innerHTML = l10n.repoInProgressPrimary.replace(
      "{0}",
      `<b>${escapeHtml(label)}</b>`
    );
    // Set as text, not markup: the subject and branch names come from the
    // repository and are not trusted to be free of HTML.
    this.secondaryElem.textContent = formatSecondaryLine(state);
    this.currentType = state.type;

    const conflicted = state.workingTreeStatus !== null && state.workingTreeStatus.conflicts > 0;
    this.banner.classList.toggle("conflicted", conflicted);
    this.banner.classList.add("active");
  }

  public isActive(): boolean {
    return this.banner.classList.contains("active");
  }
}
