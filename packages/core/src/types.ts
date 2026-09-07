import type { RepoInProgressState } from "@an-dr/commits-core/backend/queries/repoInProgress";
import {
  ActionRequest,
  ActionResponse,
  GitFileChangeType,
  QueryRequest,
  QueryResponse
} from "@an-dr/commits-core/backend/types";

export type GitRepoSet = { [repo: string]: GitRepoState };
export type GitRepoState = {
  columnWidths: number[] | null;
  /** Indentation level in the repo selector. Omitted when the host has no
   *  opinion, which leaves the view to infer nesting from the paths. */
  depth?: number;
  /** For a row that is a submodule of the row above it: how its checkout
   *  stands against the commit its parent records. Absent for a repository
   *  that is nobody's submodule, which is what leaves the row unmarked. */
  submodule?: SubmoduleState;
};

/**
 * How one submodule's checkout stands against the commit its parent records,
 * as the leading character of `git submodule status` reports it.
 *
 * "uninitialized" is the one that costs the user real time: the folder is
 * empty, so a build fails for a reason that names a missing file rather than a
 * missing submodule.
 */
export type SubmoduleState = "uninitialized" | "outOfDate" | "conflicted" | "upToDate";

/** One submodule of the open repository, by root-relative path. */
export type SubmoduleView = {
  readonly path: string;
  readonly state: SubmoduleState;
};

/**
 * One external tool the view may offer, as the host has configured it.
 *
 * Desktop-only, like `timeFormat`: a host that configures no tools sends none,
 * and the view then shows no Open in button at all.
 */
export type ToolView = {
  name: string;
  command: string;
  /** Arguments for opening the repository; empty means the tool is not offered. */
  openArgs: readonly string[];
  /** Arguments for diffing one file; empty means the tool cannot diff. */
  diffArgs: readonly string[];
};

export type GitGraphViewState = {
  autoCenterCommitDetailsView: boolean;
  committedVisual: "Avatar" | "Initials";
  avatarMode: "Auto (Fetched then Pattern)" | "Fetched Only" | "Procedural Pattern" | "Disabled";
  avatarSize: "Normal" | "Small";
  avatarShape: "Circle" | "Square";
  dateFormat: DateFormat;
  /** Hour cycle for the compact commit-date column; "system" follows the display locale. */
  timeFormat: "system" | "12h" | "24h";
  fetchAvatars: boolean;
  fileIcons: Record<string, string>;
  uiDensity: "Big" | "Normal" | "Compact";
  refreshShortcutKey: string | null;
  branchPanelGroupsFirst: boolean;
  branchPanelFlattenSingleChildGroups: boolean;
  confirmAbortRepoInProgress: boolean;
  columnVisibility: { Committed: boolean; ID: boolean };
  graphColours: string[];
  graphStyle: GraphStyle;
  initialLoadCommits: number;
  lastActiveRepo: string | null;
  loadMoreCommits: number;
  /** VS Code display language (vscode.env.language), used for Intl date formatting */
  locale: string;
  repos: GitRepoSet;
  showCurrentBranchByDefault: boolean;
  /** External tools, in the order the Open in button offers them. */
  tools?: readonly ToolView[];
};

export type Avatar = {
  image: string;
  timestamp: number;
  identicon: boolean;
};
export type AvatarCache = { [email: string]: Avatar };

export type DateFormat = "Date & Time" | "Date Only" | "Relative";
export type GraphStyle = "rounded" | "angular";

/* Infrastructure Request / Response Messages */

export type RequestFetchAvatar = {
  command: "fetchAvatar";
  repo: string;
  email: string;
  commits: string[];
};
export type ResponseFetchAvatar = {
  command: "fetchAvatar";
  email: string;
  image: string;
};

export type RequestSelectRepo = {
  command: "selectRepo";
  repo: string;
};

/** Runs a remote operation the extension host already implements. */
export type RequestRemoteOperation = {
  command: "remoteOperation";
  operation: "fetch" | "pull" | "push";
};
/** `status` is null on success, an error message otherwise -- same convention as `ResponseInProgressAction`. */
export type ResponseRemoteOperation = {
  command: "remoteOperation";
  operation: "fetch" | "pull" | "push";
  status: string | null;
};

/** Pulls one specific remote branch into the current branch (`git pull <remote> <branchName>`). */
export type RequestPullBranch = {
  command: "pullBranch";
  repo: string;
  remote: string;
  branchName: string;
};
export type ResponsePullBranch = {
  command: "pullBranch";
  status: string | null;
};

/** Deletes a branch on its remote (`git push <remote> --delete <branchName>`). */
export type RequestDeleteRemoteBranch = {
  command: "deleteRemoteBranch";
  repo: string;
  remote: string;
  branchName: string;
};
export type ResponseDeleteRemoteBranch = {
  command: "deleteRemoteBranch";
  status: string | null;
};

export type RequestLoadRepos = {
  command: "loadRepos";
  check: boolean;
};
export type ResponseLoadRepos = {
  command: "loadRepos";
  repos: GitRepoSet;
  lastActiveRepo: string | null;
};

export type RequestSaveRepoState = {
  command: "saveRepoState";
  repo: string;
  state: GitRepoState;
};

export type RequestCopyToClipboard = {
  command: "copyToClipboard";
  type: string;
  data: string;
};
export type ResponseCopyToClipboard = {
  command: "copyToClipboard";
  type: string;
  success: boolean;
};

export type RequestViewDiff = {
  command: "viewDiff";
  repo: string;
  commitHash: string;
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
};
export type ResponseViewDiff = {
  command: "viewDiff";
  success: boolean;
};

export type RequestUtilityAction =
  | {
      command: "archive";
      repo: string;
      ref: string;
    }
  | {
      command: "viewSubmoduleDiff";
      repo: string;
      fromHash: string;
      toHash: string;
      filePath: string;
    }
  | { command: "viewScm" }
  | {
      command: "viewFileAtRevision";
      repo: string;
      hash: string;
      filePath: string;
    }
  | {
      command: "openFile";
      repo: string;
      filePath: string;
      hash: string | null;
    }
  | {
      command: "openExternalUrl";
      url: string;
      type?: string;
    }
  | { command: "openExtensionSettings" }
  | {
      command: "getRelativeTimeDiff";
      unixTimestamp: number;
    };

export type ResponseUtilityAction =
  | {
      command: Exclude<RequestUtilityAction["command"], "getRelativeTimeDiff">;
      error: string | null;
    }
  | {
      command: "getRelativeTimeDiff";
      value: string;
    };

export type ResponseRefresh = {
  command: "refresh";
  /**
   * How much to reread. Absent means everything, which is what a host that
   * does not distinguish the two sends. "worktree" leaves history alone, for a
   * change that cannot have moved it.
   */
  scope?: "all" | "worktree";
};

/**
 * Asks for every submodule of the open repository and how each one stands.
 *
 * Sent alongside `repoInProgress` on each refresh, for the same reason: a
 * `git submodule add` or a branch switch that moves a submodule pointer
 * happens outside the panel as often as inside it.
 */
export type RequestSubmoduleStatus = { command: "submoduleStatus" };
export type ResponseSubmoduleStatus = {
  command: "submoduleStatus";
  repo: string;
  submodules: readonly SubmoduleView[];
};

/**
 * Initializes and checks out every submodule recursively
 * (`git submodule update --init --recursive`).
 *
 * One command for the whole tree rather than a per-submodule request: a
 * submodule that was never initialized reveals its own submodules only once it
 * is, so a caller working through a list would always be one round trip behind
 * the tree it is trying to complete.
 */
export type RequestSubmoduleUpdate = { command: "submoduleUpdate"; repo?: string };
/** `status` is null on success, Git's own failure words otherwise. */
export type ResponseSubmoduleUpdate = {
  command: "submoduleUpdate";
  status: string | null;
};

/** Asks for the operation the repository is part-way through. */
export type RequestRepoInProgress = { command: "repoInProgress" };
export type RequestInProgressAction = {
  command: "inProgressAction";
  operationType: RepoInProgressState["type"];
  action: "continue" | "abort";
};

/**
 * Runs one of the user's configured external tools.
 *
 * `args` is an argument vector the host hands the program unchanged, so the
 * page expands `{repo}` -- the only placeholder it can resolve -- before
 * sending, and leaves `{left}` and `{right}` to the host, which is where the
 * two revisions of a diff become files on disk.
 */
export type RequestRunTool = {
  command: "runTool";
  repo: string;
  program: string;
  args: string[];
  /**
   * The file and the two revisions to compare, for a diff tool.
   *
   * Both paths travel because a renamed file has a different name on each
   * side, and `type` because an added file has no old revision and a deleted
   * one no new revision -- that side is handed to the tool as an empty file,
   * which is what it is being compared against.
   */
  diff?: {
    oldFilePath: string;
    newFilePath: string;
    fromHash: string;
    toHash: string;
    type: GitFileChangeType;
  };
};

/** Whether the tool started; a message says why it did not. */
export type ResponseRunTool = {
  command: "runTool";
  status: string | null;
};

export type RequestMessage =
  | RequestRepoInProgress
  | RequestSubmoduleStatus
  | RequestSubmoduleUpdate
  | RequestInProgressAction
  | ActionRequest
  | QueryRequest
  | RequestFetchAvatar
  | RequestSelectRepo
  | RequestRemoteOperation
  | RequestPullBranch
  | RequestDeleteRemoteBranch
  | RequestLoadRepos
  | RequestSaveRepoState
  | RequestCopyToClipboard
  | RequestViewDiff
  | RequestRunTool
  | RequestUtilityAction;

/** The operation the repository is part-way through, or null when none is. */
export type ResponseRepoInProgress = {
  command: "repoInProgress";
  state: RepoInProgressState | null;
};
export type ResponseInProgressAction = {
  command: "inProgressAction";
  status: string | null;
};

export type ResponseMessage =
  | ResponseRepoInProgress
  | ResponseSubmoduleStatus
  | ResponseSubmoduleUpdate
  | ResponseInProgressAction
  | ActionResponse
  | QueryResponse
  | ResponseFetchAvatar
  | ResponseLoadRepos
  | ResponseCopyToClipboard
  | ResponseViewDiff
  | ResponseRunTool
  | ResponseUtilityAction
  | ResponseRefresh
  | ResponseRemoteOperation
  | ResponsePullBranch
  | ResponseDeleteRemoteBranch;
