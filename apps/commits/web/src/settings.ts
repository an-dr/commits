import type { GitGraphViewState } from "@an-dr/commits-core/types";
import {
  DEFAULT_SETTINGS,
  TOOLS_KEY,
  type SettingsDocument,
} from "@commits/adapter/read/settings";

/** Converts validated extension-compatible settings into shared view state. */
export function createViewState(settings: SettingsDocument = DEFAULT_SETTINGS): GitGraphViewState {
  const core = settings.core;
  const value = <T>(key: string): T => core[`an-dr-com-mit-s.${key}`] as T;
  const shortcut = value<string>("keyboardShortcut.refresh");
  return {
    autoCenterCommitDetailsView: value("autoCenterCommitDetailsView"),
    committedVisual: value("repository.commits.committedVisual"),
    avatarMode: value("repository.commits.avatar.mode"),
    avatarSize: value("repository.commits.avatar.size"),
    avatarShape: value("repository.commits.avatar.shape"),
    dateFormat: value("dateFormat"),
    timeFormat: settings.app.timeFormat,
    fetchAvatars: value("fetchAvatars"),
    fileIcons: {},
    uiDensity: value("uiDensity"),
    refreshShortcutKey: shortcut === "UNASSIGNED" ? null : shortcut.slice(-1).toLowerCase(),
    branchPanelGroupsFirst: value("branchPanel.groupsFirst"),
    branchPanelFlattenSingleChildGroups: value("branchPanel.flattenSingleChildGroups"),
    confirmAbortRepoInProgress: value("dialog.repoInProgress.confirmAbort"),
    columnVisibility: value("repository.commits.columnVisibility"),
    graphColours: value("graphColours"),
    graphStyle: value("graphStyle"),
    initialLoadCommits: value("initialLoadCommits"),
    lastActiveRepo: null,
    loadMoreCommits: value("loadMoreCommits"),
    locale: globalThis.navigator?.language || "en",
    repos: {},
    showCurrentBranchByDefault: value("showCurrentBranchByDefault"),
    tools: settings.app[TOOLS_KEY],
  };
}
