import type { GitWorkingTreeChange } from "../data-source/models";
import { buildFileTree, renderFileTree } from "./fileTree";
import { resolveFileIcon } from "./utils/fileIcons";
import { escapeHtml } from "./utils/html";
import { svgIcons, toolbarIcons } from "./utils/icons";

/**
 * One changed file, rendered as a leaf of the same tree a commit's file list
 * uses. The folder above it says where it lives, so the row carries only what
 * is specific to the working tree: which side of the index it is on, its
 * status, its counts, and the actions that move it.
 */
function renderRow(change: GitWorkingTreeChange, name: string): string {
  const renamedFrom =
    change.oldPath === undefined ? "" : ` ${ARROW} ${escapeHtml(change.oldPath)}`;
  return (
    `<li class="changesFile ${change.staged ? "staged" : "unstaged"}"` +
    ` data-path="${escapeHtml(change.path)}"` +
    ` data-staged="${change.staged}" data-status="${change.status}"` +
    ` title="${escapeHtml(change.path)}${renamedFrom}">` +
    `<span class="changesFileIcon">${resolveFileIcon(viewState.fileIcons, name) ?? svgIcons.file}</span>` +
    `<span class="changesFileName ${change.status}">${escapeHtml(name)}</span>` +
    `<span class="changesFileStaged" title="${escapeHtml(
      change.staged ? l10n.changesStagedSection : l10n.changesUnstagedSection
    )}"></span>` +
    renderCounts(change) +
    `<span class="changesFileStatus" title="${statusTitle(change.status)}">${change.status}</span>` +
    renderActions(change) +
    `</li>`
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

/**
 * Applies remembered folds to a freshly built tree. Staging a file re-reads the
 * whole working tree, so without this every fold would spring open under the
 * user on each action.
 */
function applyClosedFolders(folder: GitFolder, closed: ReadonlySet<string>): void {
  for (const entry of Object.values(folder.contents)) {
    if (entry.type === "folder") {
      entry.open = !closed.has(entry.folderPath);
      applyClosedFolders(entry, closed);
    }
  }
}

/**
 * The commit surface under the file list: a message, an amend toggle, and the
 * button. Committing is offered whatever the tree holds, because Git refuses an
 * empty commit itself and says why.
 */
export function renderChangesFooter(message: string, amend: boolean): string {
  return (
    `<div class="changesFooter">` +
    `<textarea id="changesMessage" rows="2" spellcheck="true"` +
    ` placeholder="${escapeHtml(l10n.changesMessagePlaceholder)}">${escapeHtml(message)}</textarea>` +
    `<div class="changesFooterRow">` +
    `<label class="changesAmend"><input id="changesAmend" type="checkbox"` +
    `${amend ? " checked" : ""}> ${escapeHtml(l10n.changesAmend)}</label>` +
    `<button id="changesCommitBtn" class="roundedBtn">${escapeHtml(l10n.changesCommit)}</button>` +
    `</div></div>`
  );
}

/**
 * Builds the working-tree body as one folder tree covering every change, staged
 * and unstaged alike, each row saying which side of the index it is on. It is
 * the same tree a commit's file list renders, so a path sits in the same place
 * whichever of the two the user is looking at.
 */
export function renderChangesPanel(
  changes: readonly GitWorkingTreeChange[],
  error: string | null,
  closedFolders: ReadonlySet<string> = new Set()
): string {
  if (error !== null) {
    return `<div class="changesMessage">${escapeHtml(error)}</div>`;
  }
  if (changes.length === 0) {
    return `<div class="changesMessage">${escapeHtml(l10n.changesNothingToCommit)}</div>`;
  }
  const tree = buildFileTree(changes.map((change) => change.path));
  applyClosedFolders(tree, closedFolders);
  return renderFileTree(tree, (index, name) => renderRow(changes[index], name));
}
