import type { LocalizedStrings } from "@an-dr/commits-core/webview/l10nContract";

export type Translate = (message: string) => string;

/**
 * Localized strings for the webview (main.ts, dropdown.ts).
 * Each host supplies its own translator. VS Code can pass `vscode.l10n.t`,
 * while standalone hosts can use an identity translator or their own catalog.
 * The resulting object is injected into the page as the global `l10n` value.
 */
export function createLocalizedStrings(t: Translate): LocalizedStrings {
  return {
    // UI labels
    repo: t("Repo"),
    branch: t("Branch"),
    loading: t("Loading ..."),
    filesPanelPlaceholder: t("Select a commit to see the files it changed"),
    filesPanelTitle: t("Changed Files"),
    comparisonTitle: t("Comparing"),
    repoInProgressPrimary: t("The working tree is in {0}-state."),
    repoInProgressRebase: t("Rebase"),
    repoInProgressMerge: t("Merge"),
    repoInProgressCherryPick: t("Cherry-pick"),
    repoInProgressRevert: t("Revert"),
    repoInProgressWorkingTree: t("Working Tree/Index"),
    repoInProgressClean: t("clean"),
    repoInProgressChanged: t("{0} changed"),
    repoInProgressStaged: t("{0} staged"),
    repoInProgressConflicts: t("{0} conflicts"),
    repoInProgressUntracked: t("{0} untracked"),
    repoInProgressRebasing: t("rebasing {0}"),
    repoInProgressRebasingOnto: t("rebasing {0} onto {1}"),
    repoInProgressRebasingOntoOnly: t("rebasing onto {0}"),
    repoInProgressContinue: t("Continue"),
    repoInProgressAbort: t("Abort"),
    repoInProgressAbortConfirm: t("Abort the {0} operation?"),
    repoInProgressActionFailed: t("Unable to update the repository operation"),
    branchPanelLocalBranches: t("Local Branches"),
    branchPanelNoBranches: t("No branches"),
    branchPanelNoMatchingBranches: t("No matching branches"),
    fullDiffUnableToLoad: t("Unable to load the file contents"),
    fullDiffChangeCount: t("{0} / {1}"),
    fullDiffFoldedLines: t("… {0} unchanged lines …"),
    fullDiffNoChanges: t("This file has no contents to show"),
    refresh: t("Refresh"),
    resetToHead: t("Reset to HEAD"),
    fetchFromRemotes: t("Fetch from Remote(s)"),
    fetchPullTitle: t("Fetch from Remote(s) · Double-click to Pull"),
    pullCurrentBranch: t("Pull Current Branch"),
    pushCurrentBranch: t("Push Current Branch"),
    findNoMatches: t("No matches"),
    findMatchCount: t("{0} of {1}"),
    loadMore: t("Load More Commits"),
    showAll: t("Show All"),
    filterPlaceholder: t("Filter {0}..."),
    noResultsFound: t("No results found."),
    graph: t("Graph"),
    dev: t("Dev"),
    id: t("ID"),

    // Error messages
    unableToLoadCommitDetails: t("Unable to load commit details"),
    unableToCopyToClipboard: t("Unable to Copy {0} to Clipboard"),
    unableToOpenUrl: t("Unable to open URL"),
    unableToViewDiff: t("Unable to view diff of file"),
    unableToAddTag: t("Unable to Add Tag"),
    unableToCheckoutBranch: t("Unable to Checkout Branch"),
    unableToCheckoutCommit: t("Unable to Checkout Commit"),
    unableToCherryPick: t("Unable to Cherry Pick Commit"),
    unableToCreateBranch: t("Unable to Create Branch"),
    unableToDeleteBranch: t("Unable to Delete Branch"),
    unableToDeleteTag: t("Unable to Delete Tag"),
    unableToMergeBranch: t("Unable to Merge Branch"),
    unableToMergeCommit: t("Unable to Merge Commit"),
    unableToPushTag: t("Unable to Push Tag"),
    unableToRenameBranch: t("Unable to Rename Branch"),
    unableToReset: t("Unable to Reset to Commit"),
    unableToRevert: t("Unable to Revert Commit"),
    invalidCharacters: t("Unable to {0}, one or more invalid characters entered."),

    // Actions
    addTag: t("Add Tag"),
    createBranch: t("Create Branch"),
    checkout: t("Checkout"),
    cherryPick: t("Cherry Pick"),
    revert: t("Revert"),
    merge: t("Merge into current branch"),
    reset: t("Reset current branch to this Commit"),
    copyCommitHash: t("Copy Commit Hash to Clipboard"),
    copyTagName: t("Copy Tag Name to Clipboard"),
    copyBranchName: t("Copy Branch Name to Clipboard"),
    deleteTag: t("Delete Tag"),
    pushTag: t("Push Tag"),
    checkoutBranch: t("Checkout Branch"),
    renameBranch: t("Rename Branch"),
    deleteBranch: t("Delete Branch"),

    typeCommitHash: t("Commit Hash"),
    typeTagName: t("Tag Name"),
    typeBranchName: t("Branch Name"),

    // label
    labelTag: t("the tag"),
    labelBranch: t("the branch"),
    labelCurrentBranch: t("the current branch"),

    // Dialog
    dialogAddTagTitle: t("Add tag to commit {0}"),
    dialogAddTagName: t("Name"),
    dialogAddTagType: t("Type"),
    dialogAddTagMessage: t("Message"),
    dialogAddTagTypeAnnotated: t("Annotated"),
    dialogAddTagTypeLightweight: t("Lightweight"),
    dialogAddTagOptional: t("Optional"),
    dialogAddTagSubmit: t("Add Tag"),
    dialogCreateBranchTitle: t("Enter the name of the branch {0}"),
    dialogCreateBranchSubmit: t("Create Branch"),
    dialogCheckoutConfirm: t(
      "Are you sure you want to checkout commit {0}? This will result in a 'detached HEAD' state."
    ),
    dialogCherryPickConfirm: t("Are you sure you want to cherry pick commit {0}?"),
    dialogRevertConfirm: t("Are you sure you want to revert commit {0}?"),
    dialogMergeConfirm: t("Are you sure you want to merge {0} into {1}?"),
    dialogMergeNoFastForward: t("Create a new commit even if fast-forward is possible"),
    dialogResetConfirm: t("Are you sure you want to reset {0} to commit {1}?"),
    dialogResetSoft: t("Soft - Keep all changes, but reset head"),
    dialogResetMixed: t("Mixed - Keep working tree, but reset index"),
    dialogResetHard: t("Hard - Discard all changes"),
    dialogDeleteConfirm: t("Are you sure you want to delete {0} {1}?"),
    dialogDeleteForceDelete: t("Force Delete"),
    dialogRenameBranchTitle: t("Enter the new name for the branch {0}:"),
    dialogRenameBranchSubmit: t("Rename Branch"),
    dialogPushTagConfirm: t("Are you sure you want to push the tag {0}?"),
    dialogYes: t("Yes"),
    dialogYesCherryPick: t("Yes, cherry pick commit"),
    dialogYesRevert: t("Yes, revert commit"),
    dialogYesMerge: t("Yes, merge"),
    dialogYesReset: t("Yes, reset"),
    dialogCancel: t("Cancel"),
    dialogDismiss: t("Dismiss"),

    // Status
    pushingTag: t("Pushing Tag"),

    // Relative commit dates are formatted by Intl.RelativeTimeFormat in the
    // webview (see utils/date.ts), so no time units are declared here.

    // Commit details ({0} is the value; the text before it is rendered bold)
    detailCommit: t("Commit: {0}"),
    detailParents: t("Parents: {0}"),
    detailAuthor: t("Author: {0}"),
    detailDate: t("Date: {0}"),
    detailCommitter: t("Committer: {0}"),

    uncommittedChanges: t("Uncommitted Changes ({0})"),

    // File tooltips
    tooltipBinaryFile: t("This is a binary file, unable to view diff."),
    tooltipRenamedTo: t("{0} was renamed to {1}"),
    tooltipAddition: t("{0} addition"),
    tooltipAdditions: t("{0} additions"),
    tooltipDeletion: t("{0} deletion"),
    tooltipDeletions: t("{0} deletions")
  };
}
