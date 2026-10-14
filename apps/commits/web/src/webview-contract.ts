/**
 * Markup the standalone integration reads or extends but does not own.
 *
 * The shared graph (packages/core), its shell (packages/webview-shell), and
 * this app's own page (main.ts) render these elements; integration.ts finds
 * them here and nowhere else. Renaming one of them in those packages breaks
 * the health button, the source sections, or navigation without a type
 * error, so webview-contract.test.ts checks every entry against the code that
 * renders it.
 */
export const WEBVIEW = {
  /** Toolbar the health button and selector sections are added to. */
  controlsId: "controls",
  /** Activity line the health button sits beside. */
  activityStatusId: "activityStatus",
  /** Scrolling graph view, reset to the top for `--show graph`. */
  viewId: "view",
  /** Repository dropdown menu, and the control that opens and closes it. */
  repositoryMenu: "#repoSelect .dropdownMenu",
  repositoryMenuToggle: "#repoSelect .dropdownCurrentValue",
  /** The uncommitted-changes row, and commit rows keyed by `data-hash`. */
  workingTreeRow: "tr.unsavedChanges",
  commitRow: "tr[data-hash]",
  /** Clicking a row's description selects it, as a user's click does. */
  rowDescription: ".description",
  /** This app's recent list, which source sections follow. */
  recentRepositoriesId: "standaloneRecentRepos",
  /** Elements whose click should refresh the repository sources. */
  sourceRefreshTriggers: "#repoSelect, #standaloneMenuOpenRepo, #standaloneMenuRecentGroup",
} as const;
