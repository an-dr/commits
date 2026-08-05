import type { GitWorkingTreeChange } from "../data-source/models";
import { resolveFileIcon } from "./utils/fileIcons";
import { escapeHtml } from "./utils/html";
import { svgIcons, toolbarIcons } from "./utils/icons";

/**
 * The working tree is a flat list of files rather than a folder tree: a change
 * set is normally small, and the path beside each name says where it lives.
 */
function renderRow(change: GitWorkingTreeChange): string {
  const slash = change.path.lastIndexOf("/");
  const name = slash < 0 ? change.path : change.path.slice(slash + 1);
  const directory = slash < 0 ? "" : change.path.slice(0, slash);
  const renamedFrom =
    change.oldPath === undefined ? "" : ` ${ARROW} ${escapeHtml(change.oldPath)}`;
  return (
    `<div class="changesFile" data-path="${escapeHtml(change.path)}"` +
    ` data-staged="${change.staged}" data-status="${change.status}"` +
    ` title="${escapeHtml(change.path)}${renamedFrom}">` +
    `<span class="changesFileIcon">${resolveFileIcon(viewState.fileIcons, name) ?? svgIcons.file}</span>` +
    `<span class="changesFileName ${change.status}">${escapeHtml(name)}</span>` +
    (directory === ""
      ? ""
      : `<span class="changesFileDir">${escapeHtml(directory)}</span>`) +
    renderCounts(change) +
    `<span class="changesFileStatus" title="${statusTitle(change.status)}">${change.status}</span>` +
    renderActions(change) +
    `</div>`
  );
}

/**
 * The actions each side offers: a staged file can only be taken back out, while
 * an unstaged one can be staged or thrown away.
 */
function renderActions(change: GitWorkingTreeChange): string {
  const button = (action: string, title: string, icon: string) =>
    `<button class="changesFileBtn" data-action="${action}" title="${escapeHtml(title)}"` +
    ` aria-label="${escapeHtml(title)}">${icon}</button>`;
  return (
    `<span class="changesFileActions">` +
    (change.staged
      ? button("unstage", l10n.changesUnstageFile, toolbarIcons.minus)
      : button("stage", l10n.changesStageFile, toolbarIcons.plus) +
        button("discard", l10n.changesDiscardFile, toolbarIcons.cross)) +
    `</span>`
  );
}

const ARROW = "&#8592;";

function renderCounts(change: GitWorkingTreeChange): string {
  if (change.additions === null || change.deletions === null) {
    return "";
  }
  return (
    `<span class="changesFileCounts">` +
    `<span class="changesFileAdd">+${change.additions}</span>` +
    `<span class="changesFileDel">-${change.deletions}</span></span>`
  );
}

function statusTitle(status: GitWorkingTreeChange["status"]): string {
  switch (status) {
    case "A":
      return l10n.changesStatusAdded;
    case "D":
      return l10n.changesStatusDeleted;
    case "R":
      return l10n.changesStatusRenamed;
    case "U":
      return l10n.changesStatusUntracked;
    default:
      return l10n.changesStatusModified;
  }
}

function renderSection(label: string, changes: readonly GitWorkingTreeChange[]): string {
  if (changes.length === 0) {
    return "";
  }
  const rows = changes
    .toSorted((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }))
    .map(renderRow)
    .join("");
  return (
    `<div class="changesSectionHeader">${escapeHtml(label)}` +
    `<span class="changesSectionCount">${changes.length}</span></div>${rows}`
  );
}

/** Builds the working-tree body: what is staged, then what is not. */
export function renderChangesPanel(
  changes: readonly GitWorkingTreeChange[],
  error: string | null
): string {
  if (error !== null) {
    return `<div class="changesMessage">${escapeHtml(error)}</div>`;
  }
  if (changes.length === 0) {
    return `<div class="changesMessage">${escapeHtml(l10n.changesNothingToCommit)}</div>`;
  }
  return (
    renderSection(
      l10n.changesStagedSection,
      changes.filter((change) => change.staged)
    ) +
    renderSection(
      l10n.changesUnstagedSection,
      changes.filter((change) => !change.staged)
    )
  );
}
