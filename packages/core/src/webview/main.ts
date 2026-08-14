import type { RepoInProgressState } from "@an-dr/commits-core/backend/queries/repoInProgress";
import type {
  GitCommandStatus,
  GitCommitDetails,
  GitCommitNode,
  GitFileChange,
  GitFileChangeType,
  GitResetMode
} from "@an-dr/commits-core/backend/types";

import type { GitWorkingTreeChange } from "@an-dr/commits-core/data-source/models";
import { BranchPanel, NO_REMOTE_INFO, type BranchPanelRemoteInfo } from "./branchPanel";
import { renderChangesFooter, renderChangesPanel } from "./changesPanelRender";
import { CommitSelection, readSelectionGesture } from "./commitSelection";
import { hideContextMenuIfOpen, isContextMenuOpen, showContextMenu } from "./contextMenu";
import {
  hideDialog,
  isDialogOpen,
  showActionRunningDialog,
  showCheckboxDialog,
  showConfirmationDialog,
  showErrorDialog,
  showFormDialog,
  showRefInputDialog,
  showSelectDialog
} from "./dialog";
import { Dropdown } from "./dropdown";
import { buildFileTree, renderFileTree } from "./fileTree";
import { DEFAULT_FILES_PANEL_WIDTH, FilesPanel } from "./filesPanel";
import { FindWidget } from "./findWidget";
import { FullDiffPanel } from "./fullDiffPanel";
import { Graph } from "./graph";
import { observeExternalUrls } from "./observers/urlEvents";
import { RepoInProgressBanner } from "./repoInProgressBanner";
import { Toolbar } from "./toolbar";
import { renderAuthorVisualHtml } from "./utils/avatarVisuals";
import { formatIsoDate, formatShortDate, formatShortTime, isSameLocalDay, pad2 } from "./utils/date";
import { addListenerToClass, insertAfter } from "./utils/dom";
import { resolveFileIcon } from "./utils/fileIcons";
import { abbrevCommit, arraysEqual, ELLIPSIS } from "./utils/git";
import { UNCOMMITTED } from "./utils/graphConstants";
import { getVSCodeStyle, sendMessage, vscode } from "./utils/host";
import { escapeHtml, unescapeHtml } from "./utils/html";
import { svgIcons } from "./utils/icons";
import { renderTagPill } from "./utils/refPills";
import { nextBranchSelection } from "./branchSelection";

/** Asks the extension host to run a remote operation for the selected repository. */
function requestRemoteOperation(operation: "fetch" | "pull" | "push") {
  sendMessage({ command: "remoteOperation", operation });
}

class GitGraphView {
  private gitRepos: GG.GitRepoSet;
  private gitBranches: string[] = [];
  private gitBranchHead: string | null = null;
  private commits: GitCommitNode[] = [];
  private commitFilterText: string = "";
  private commitHead: string | null = null;
  private commitLookup: { [hash: string]: number } = {};
  private avatars: AvatarImageCollection = {};
  private currentBranch: string | null = null;
  /**
   * Every branch the user has selected. `currentBranch` stays the first entry
   * so single-branch call sites keep working unchanged.
   */
  private currentBranches: string[] = [];
  private currentRepo!: string;

  private graph: Graph;
  private config: Config;
  private moreCommitsAvailable: boolean = false;
  private showRemoteBranches: boolean = true;
  private expandedCommit: ExpandedCommit | null = null;
  private maxCommits: number;

  private tableElem: HTMLElement;
  private findWidget: FindWidget;
  private footerElem: HTMLElement;
  private repoDropdown: Dropdown;
  private branchPanel: BranchPanel;
  private toolbar: Toolbar;
  private readonly selection = new CommitSelection();
  /** The two commits being compared, or null when not comparing. */
  private comparison: { from: string; to: string } | null = null;
  /** Commit whose files the panel is previewing, when no row is open. */
  private previewHash: string | null = null;
  /** True while the panel shows the working tree rather than a revision. */
  private workingTreeOpen = false;
  private workingTree: GitWorkingTreeChange[] = [];
  /** Kept across re-reads of the tree so typing is never lost to a refresh. */
  private commitMessage = "";
  private commitAmend = false;
  private scrollShadowElem: HTMLElement;
  private filesPanel: FilesPanel;
  private fullDiffPanel: FullDiffPanel;
  private filesPanelWidth: number;
  private repoInProgressBanner: RepoInProgressBanner;

  private loadBranchesCallback: ((changes: boolean, isRepo: boolean) => void) | null = null;
  private loadCommitsCallback: ((changes: boolean) => void) | null = null;

  constructor(
    repos: GG.GitRepoSet,
    lastActiveRepo: string | null,
    config: Config,
    prevState: WebViewState | null
  ) {
    this.gitRepos = repos;
    this.config = config;
    this.maxCommits = config.initialLoadCommits;
    this.graph = new Graph("commitGraph", this.config);
    this.tableElem = document.getElementById("commitTable")!;
    this.findWidget = new FindWidget(this.tableElem);
    this.footerElem = document.getElementById("footer")!;
    this.repoDropdown = new Dropdown("repoSelect", true, l10n.repo, (value) => {
      this.changeRepo(value);
      sendMessage({ command: "selectRepo", repo: value });
      this.refresh(true);
    });
    this.branchPanel = new BranchPanel(
      prevState?.branchPanel,
      () => this.saveState(),
      (value, additive) => this.selectBranch(value, additive),
      (value, kind, source, event) => this.handleBranchPanelAction(value, kind, source, event)
    );
    this.scrollShadowElem = <HTMLInputElement>document.getElementById("scrollShadow")!;
    this.filesPanelWidth = prevState?.filesPanelWidth ?? DEFAULT_FILES_PANEL_WIDTH;
    this.repoInProgressBanner = new RepoInProgressBanner((type, action) => {
      const run = () => sendMessage({ command: "inProgressAction", operationType: type, action });
      if (action === "abort" && viewState.confirmAbortRepoInProgress) {
        showConfirmationDialog(
          l10n.repoInProgressAbortConfirm.replace("{0}", type),
          run,
          document.getElementById("repoInProgressBanner")
        );
      } else {
        run();
      }
    });
    this.filesPanel = new FilesPanel(this.filesPanelWidth, (width) => {
      this.filesPanelWidth = width;
      this.saveState();
    });
    this.fullDiffPanel = new FullDiffPanel(prevState?.fullDiffPanel, () => this.saveState());
    // The branch panel owns the sidebar toggle button, including its icon and
    // active state, so the toolbar only holds the buttons on the right.
    this.toolbar = new Toolbar();
    this.renderToolbar();
    const filterElem = <HTMLInputElement | null>document.getElementById("commitFilter");
    if (filterElem !== null) {
      filterElem.addEventListener("input", () => this.applyCommitFilter(filterElem.value));
      filterElem.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.applyCommitFilter("");
          filterElem.value = "";
        }
      });
    }
    this.observeWindowSizeChanges();
    this.observeWebviewStyleChanges();
    this.observeWebviewScroll();
    this.observeTopBarHeight();

    this.renderShowLoading();
    if (prevState) {
      this.setSelectedBranches(
        Array.isArray(prevState.currentBranches) && prevState.currentBranches.length > 0
          ? prevState.currentBranches
          : prevState.currentBranch !== null
            ? [prevState.currentBranch]
            : []
      );
      this.showRemoteBranches = prevState.showRemoteBranches;
      if (typeof this.gitRepos[prevState.currentRepo] !== "undefined") {
        this.currentRepo = prevState.currentRepo;
        this.maxCommits = prevState.maxCommits;
        this.expandedCommit = prevState.expandedCommit;
        this.avatars = prevState.avatars;
        this.loadBranches(prevState.gitBranches, prevState.gitBranchHead, true, true);
        this.loadCommits(
          prevState.commits,
          prevState.commitHead,
          prevState.moreCommitsAvailable,
          true
        );
      }
    }
    this.loadRepos(this.gitRepos, lastActiveRepo);
    this.requestLoadBranchesAndCommits(false);
  }

  /* Loading Data */
  public loadRepos(repos: GG.GitRepoSet, lastActiveRepo: string | null) {
    this.gitRepos = repos;
    this.saveState();

    let repoPaths = Object.keys(repos),
      changedRepo = false;
    if (typeof repos[this.currentRepo] === "undefined") {
      this.changeRepo(
        lastActiveRepo !== null && typeof repos[lastActiveRepo] !== "undefined"
          ? lastActiveRepo
          : repoPaths[0]
      );
      changedRepo = true;
    } else if (
      lastActiveRepo !== null &&
      lastActiveRepo !== this.currentRepo &&
      typeof repos[lastActiveRepo] !== "undefined"
    ) {
      // The host asks for a different repository than the one on screen, which
      // happens when one is opened outside the view. Adding it to the set is
      // not enough: without this the view keeps showing the previous one.
      this.changeRepo(lastActiveRepo);
      changedRepo = true;
    }

    // Sorted so a submodule's path (a string-prefixed extension of its
    // parent's) always lands right after its parent and before any sibling,
    // which is what lets the dropdown render this as a tree by indentation
    // alone, with no separate hierarchy to keep in sync. A host that knows
    // which of those nested paths are really owned by their parent says so
    // with `depth`; without it, containment is the only thing to go on.
    let sortedPaths = [...repoPaths].sort(),
      options = [],
      repoComps,
      i;
    for (i = 0; i < sortedPaths.length; i++) {
      const path = sortedPaths[i];
      repoComps = path.split("/");
      const stated = repos[path].depth;
      const depth =
        typeof stated === "number"
          ? stated
          : sortedPaths.filter((other) => other !== path && path.startsWith(other + "/")).length;
      options.push({ name: repoComps[repoComps.length - 1], value: path, depth });
    }
    this.repoDropdown.setOptions(options, this.currentRepo);

    if (changedRepo) {
      this.refresh(true);
    }
  }

  public loadBranches(
    branchOptions: string[],
    branchHead: string | null,
    hard: boolean,
    isRepo: boolean,
    remoteInfo: BranchPanelRemoteInfo = NO_REMOTE_INFO
  ) {
    if (!isRepo) {
      this.triggerLoadBranchesCallback(false, isRepo);
      return;
    }
    // Tracking and remote data arrive with the branches but are not part of
    // what decides whether the list itself changed.
    this.branchPanel.setRemoteInfo(remoteInfo);
    if (
      !hard &&
      arraysEqual(this.gitBranches, branchOptions, (a, b) => a === b) &&
      this.gitBranchHead === branchHead
    ) {
      this.triggerLoadBranchesCallback(false, isRepo);
      return;
    }

    this.gitBranches = branchOptions;
    this.gitBranchHead = branchHead;
    const stillPresent = this.currentBranches.filter(
      (branch) => branch === "" || this.gitBranches.indexOf(branch) > -1
    );
    this.setSelectedBranches(
      stillPresent.length > 0
        ? stillPresent
        : [
            this.config.showCurrentBranchByDefault && this.gitBranchHead !== null
              ? this.gitBranchHead
              : ""
          ]
    );
    this.saveState();

    let options = [{ name: l10n.showAll, value: "" }];
    for (let i = 0; i < this.gitBranches.length; i++) {
      options.push({
        name:
          this.gitBranches[i].indexOf("remotes/") === 0
            ? this.gitBranches[i].substring(8)
            : this.gitBranches[i],
        value: this.gitBranches[i]
      });
    }
    this.branchPanel.setOptions(options, this.currentBranches);
    this.branchPanel.setHead(this.gitBranchHead, this.commitHead);
    this.renderToolbar();

    this.triggerLoadBranchesCallback(true, isRepo);
  }
  private triggerLoadBranchesCallback(changes: boolean, isRepo: boolean) {
    if (this.loadBranchesCallback !== null) {
      this.loadBranchesCallback(changes, isRepo);
      this.loadBranchesCallback = null;
    }
  }

  /**
   * Closes whatever Escape should close next: the diff panel, then an open
   * commit, then the selection itself.
   */
  public dismissTopLayer() {
    if (!this.fullDiffPanel.isHidden()) {
      this.fullDiffPanel.close();
      return;
    }
    if (this.expandedCommit !== null) {
      this.hideCommitDetails();
      return;
    }
    this.clearSelection();
  }

  /** Drops the selection, returning the panel to the open commit's own files. */
  public clearSelection() {
    if (this.selection.size() === 0 && !this.workingTreeOpen) {
      return;
    }
    this.selection.clear();
    this.comparison = null;
    this.previewHash = null;
    this.workingTreeOpen = false;
    this.renderSelection();
    this.filesPanel.clear();
    this.filesPanel.hide();
  }

  /**
   * Paints the selection onto the table and, once exactly two commits are
   * picked, asks for what changed between them.
   */
  private renderSelection() {
    for (const row of Array.from(document.querySelectorAll<HTMLElement>("tr.commit"))) {
      row.classList.toggle("selected", this.selection.has(row.dataset.hash ?? ""));
    }
    // Not a commit, so it carries no hash the selection set could match: its
    // own open/closed state is what "selected" means for this row.
    document
      .querySelector<HTMLElement>(".unsavedChanges")
      ?.classList.toggle("selected", this.workingTreeOpen);
    const hashes = this.commits.map((commit) => commit.hash);
    const comparison = this.selection.getComparison(hashes);
    this.comparison = comparison;
    if (comparison === null) {
      return;
    }
    this.hideCommitDetails();
    this.filesPanel.setContentLoading();
    this.filesPanel.show();
    sendMessage({
      command: "commitComparison",
      repo: this.currentRepo!,
      fromHash: comparison.from,
      toHash: comparison.to
    });
  }

  /** Renders the file list for the two selected commits. */
  public renderComparison(fileChanges: GitFileChange[], error: string | null) {
    if (this.comparison === null) {
      return;
    }
    if (error !== null) {
      this.filesPanel.setContent(`<div class="filesPanelPlaceholder">${escapeHtml(error)}</div>`);
      return;
    }
    const fileTree = generateGitFileTree(fileChanges);
    this.filesPanel.setContent(generateGitFileTreeHtml(fileTree, fileChanges) + "</table>");
    this.registerFileTreeListeners(fileTree, this.comparison.from, this.comparison.to);
  }

  public renderFullDiff(data: Parameters<FullDiffPanel["render"]>[0]) {
    this.fullDiffPanel.render(data);
  }

  private selectBranch(value: string, additive = false) {
    this.setSelectedBranches(nextBranchSelection(this.currentBranches, value, additive));
    this.branchPanel.setSelectedValues(this.currentBranches);
    this.maxCommits = this.config.initialLoadCommits;
    this.expandedCommit = null;
    this.saveState();
    this.renderShowLoading();
    this.requestLoadCommits(true, () => {});
  }

  /**
   * Declares the toolbar's buttons. Rebuilt whenever repository state changes,
   * because which remote actions apply depends on the branch and its remotes.
   */
  private renderToolbar() {
    const remoteAvailable = this.gitBranchHead !== null && this.gitBranchHead !== "HEAD";
    this.toolbar.setButtons([
      {
        id: "refreshBtn",
        icon: '<i class="ti ti-refresh"></i>',
        title: l10n.refresh,
        visible: true,
        onClick: () => this.refresh(true)
      },
      {
        id: "resetBtn",
        icon: '<i class="ti ti-history"></i>',
        title: l10n.resetToHead,
        visible: remoteAvailable,
        onClick: () => this.resetToHead()
      },
      // One button for both directions inward, as in 2.0: a click fetches, a
      // double click pulls, and the menu carries both plus the advanced form.
      {
        id: "pullBtn",
        icon: '<i class="ti ti-download"></i>',
        title: l10n.fetchPullTitle,
        visible: true,
        onClick: () => requestRemoteOperation("fetch"),
        onDoubleClick: remoteAvailable ? () => requestRemoteOperation("pull") : undefined,
        overflowActions: () => [
          { title: l10n.fetchFromRemotes, onClick: () => requestRemoteOperation("fetch") },
          ...(remoteAvailable
            ? [{ title: l10n.pullCurrentBranch, onClick: () => requestRemoteOperation("pull") }]
            : [])
        ]
      },
      {
        id: "pushBtn",
        icon: '<i class="ti ti-arrow-up"></i>',
        title: l10n.pushCurrentBranch,
        visible: remoteAvailable,
        onClick: () => requestRemoteOperation("push")
      }
    ]);
  }

  /** Resets the current branch to HEAD, discarding the working tree. */
  private resetToHead() {
    if (this.gitBranchHead === null) {
      return;
    }
    showSelectDialog(
      l10n.dialogResetConfirm
        .replace("{0}", `<b><i>${escapeHtml(this.gitBranchHead)}</i></b>`)
        .replace("{1}", "<b><i>HEAD</i></b>"),
      "hard",
      [
        { name: l10n.dialogResetSoft, value: "soft" },
        { name: l10n.dialogResetMixed, value: "mixed" },
        { name: l10n.dialogResetHard, value: "hard" }
      ],
      l10n.dialogYesReset,
      (mode) =>
        sendMessage({
          command: "resetToCommit",
          repo: this.currentRepo!,
          commitHash: "HEAD",
          resetMode: <GitResetMode>mode
        }),
      document.getElementById("resetBtn")
    );
  }

  private handleBranchPanelAction(
    value: string,
    kind: "doubleClick" | "contextMenu",
    source: HTMLElement,
    event: MouseEvent
  ) {
    const remote = value.startsWith("remotes/");
    const current = source.classList.contains("currentBranch");
    const name = remote ? value.slice("remotes/".length) : value;
    const checkout = () => {
      if (remote) {
        const parts = name.split("/");
        showRefInputDialog(
          l10n.dialogCreateBranchTitle.replace("{0}", `<b><i>${escapeHtml(name)}</i></b>`),
          parts.at(-1)!,
          l10n.checkoutBranch,
          (newBranch) =>
            sendMessage({
              command: "checkoutBranch",
              repo: this.currentRepo,
              branchName: newBranch,
              remoteBranch: name
            }),
          source
        );
      } else {
        sendMessage({
          command: "checkoutBranch",
          repo: this.currentRepo,
          branchName: name,
          remoteBranch: null
        });
      }
    };
    if (kind === "doubleClick") {
      if (!current) {
        checkout();
      }
      return;
    }
    const menu: ContextMenuElement[] = current
      ? []
      : [{ title: l10n.checkoutBranch, onClick: checkout }];
    if (!remote) {
      menu.push({
        title: l10n.renameBranch + ELLIPSIS,
        onClick: () =>
          showRefInputDialog(
            l10n.dialogRenameBranchTitle.replace("{0}", `<b><i>${escapeHtml(name)}</i></b>`),
            name,
            l10n.dialogRenameBranchSubmit,
            (newName) =>
              sendMessage({
                command: "renameBranch",
                repo: this.currentRepo,
                oldName: name,
                newName
              }),
            source
          )
      });
      if (!current) {
        menu.push(
          {
            title: l10n.deleteBranch + ELLIPSIS,
            onClick: () =>
              showCheckboxDialog(
                l10n.dialogDeleteConfirm
                  .replace("{0}", l10n.labelBranch)
                  .replace("{1}", `<b><i>${escapeHtml(name)}</i></b>`),
                l10n.dialogDeleteForceDelete,
                false,
                l10n.deleteBranch,
                (forceDelete) =>
                  sendMessage({
                    command: "deleteBranch",
                    repo: this.currentRepo,
                    branchName: name,
                    forceDelete
                  }),
                source
              )
          },
          {
            title: l10n.merge + ELLIPSIS,
            onClick: () =>
              showCheckboxDialog(
                l10n.dialogMergeConfirm
                  .replace("{0}", `<b><i>${escapeHtml(name)}</i></b>`)
                  .replace("{1}", l10n.labelCurrentBranch),
                l10n.dialogMergeNoFastForward,
                true,
                l10n.dialogYesMerge,
                (createNewCommit) =>
                  sendMessage({
                    command: "mergeBranch",
                    repo: this.currentRepo,
                    branchName: name,
                    createNewCommit
                  }),
                source
              )
          }
        );
      }
    } else {
      // A remote-tracking ref's name is "<remote>/<branch>"; the remote name
      // never contains a slash, so only the first one splits it.
      const slash = name.indexOf("/");
      const remoteName = name.slice(0, slash);
      const remoteBranchOnly = name.slice(slash + 1);
      menu.push(
        {
          title: l10n.merge + ELLIPSIS,
          onClick: () =>
            showCheckboxDialog(
              l10n.dialogMergeConfirm
                .replace("{0}", `<b><i>${escapeHtml(name)}</i></b>`)
                .replace("{1}", l10n.labelCurrentBranch),
              l10n.dialogMergeNoFastForward,
              true,
              l10n.dialogYesMerge,
              (createNewCommit) =>
                sendMessage({
                  command: "mergeBranch",
                  repo: this.currentRepo,
                  branchName: name,
                  createNewCommit
                }),
              source
            )
        },
        {
          title: l10n.pullIntoCurrentBranch + ELLIPSIS,
          onClick: () =>
            showConfirmationDialog(
              l10n.dialogPullBranchConfirm
                .replace("{0}", `<b><i>${escapeHtml(name)}</i></b>`)
                .replace("{1}", l10n.labelCurrentBranch),
              () =>
                sendMessage({
                  command: "pullBranch",
                  repo: this.currentRepo,
                  remote: remoteName,
                  branchName: remoteBranchOnly
                }),
              source
            )
        },
        {
          title: l10n.deleteRemoteBranch + ELLIPSIS,
          onClick: () =>
            showConfirmationDialog(
              l10n.dialogDeleteConfirm
                .replace("{0}", l10n.labelBranch)
                .replace("{1}", `<b><i>${escapeHtml(name)}</i></b>`),
              () =>
                sendMessage({
                  command: "deleteRemoteBranch",
                  repo: this.currentRepo,
                  remote: remoteName,
                  branchName: remoteBranchOnly
                }),
              source
            )
        }
      );
    }
    menu.push(null, {
      title: l10n.copyBranchName,
      onClick: () => sendMessage({ command: "copyToClipboard", type: "Branch Name", data: name })
    });
    showContextMenu(event, menu, source);
  }

  public loadCommits(
    commits: GitCommitNode[],
    commitHead: string | null,
    moreAvailable: boolean,
    hard: boolean
  ) {
    if (
      !hard &&
      this.moreCommitsAvailable === moreAvailable &&
      this.commitHead === commitHead &&
      arraysEqual(
        this.commits,
        commits,
        (a, b) =>
          a.hash === b.hash &&
          arraysEqual(a.refs, b.refs, (ra, rb) => ra.name === rb.name && ra.type === rb.type) &&
          arraysEqual(a.parentHashes, b.parentHashes, (pa, pb) => pa === pb)
      )
    ) {
      if (this.commits.length > 0 && this.commits[0].hash === UNCOMMITTED) {
        this.commits[0] = commits[0];
        this.saveState();
        this.renderUncommitedChanges();
      }
      this.triggerLoadCommitsCallback(false);
      return;
    }

    this.moreCommitsAvailable = moreAvailable;
    this.commits = commits;
    this.commitHead = commitHead;
    // Branches and commits arrive independently, so the panel is told again
    // once the revision HEAD resolves to is known.
    this.branchPanel.setHead(this.gitBranchHead, this.commitHead);
    if (this.commits.length > 0 && this.commits[0].hash === UNCOMMITTED) {
      const match = this.commits[0].message.match(/\((\d+)\)$/);
      const count = match ? match[1] : "?";
      this.commits[0].message = l10n.uncommittedChanges.replace("{0}", count);
    }
    this.commitLookup = {};
    this.saveState();

    let i: number,
      expandedCommitVisible = false,
      avatarsNeeded: { [email: string]: string[] } = {};
    for (i = 0; i < this.commits.length; i++) {
      this.commitLookup[this.commits[i].hash] = i;
      if (this.expandedCommit !== null && this.expandedCommit.hash === this.commits[i].hash) {
        expandedCommitVisible = true;
      }
      if (
        this.config.fetchAvatars &&
        this.config.avatarMode !== "Disabled" &&
        typeof this.avatars[this.commits[i].email] !== "string" &&
        this.commits[i].email !== ""
      ) {
        if (typeof avatarsNeeded[this.commits[i].email] === "undefined") {
          avatarsNeeded[this.commits[i].email] = [this.commits[i].hash];
        } else {
          avatarsNeeded[this.commits[i].email].push(this.commits[i].hash);
        }
      }
    }

    this.graph.loadCommits(this.commits, this.commitHead, this.commitLookup);

    if (this.expandedCommit !== null && !expandedCommitVisible) {
      this.expandedCommit = null;
      this.saveState();
    }
    this.render();

    this.triggerLoadCommitsCallback(true);
    this.fetchAvatars(avatarsNeeded);
  }
  private triggerLoadCommitsCallback(changes: boolean) {
    if (this.loadCommitsCallback !== null) {
      this.loadCommitsCallback(changes);
      this.loadCommitsCallback = null;
    }
  }

  public loadAvatar(email: string, image: string) {
    this.avatars[email] = image;
    this.saveState();
    let avatarsElems = <HTMLCollectionOf<HTMLElement>>document.getElementsByClassName("avatar"),
      escapedEmail = escapeHtml(email);
    for (let i = 0; i < avatarsElems.length; i++) {
      if (avatarsElems[i].dataset.email === escapedEmail) {
        avatarsElems[i].classList.remove("empty");
        delete avatarsElems[i].dataset.procedural;
        avatarsElems[i].innerHTML = '<img class="avatarImg" src="' + image + '">';
      }
    }
  }

  /* Refresh */
  /**
   * Hides commit rows that do not match the filter text, matching on message,
   * author, email, or a hash prefix. Filtering is presentational: the rows
   * stay in the table and the graph is untouched, so clearing the filter
   * restores the view without reloading.
   */
  public applyCommitFilter(text: string) {
    this.commitFilterText = text;
    const active = text !== "";
    document.body.classList.toggle("commitFilterActive", active);

    // The uncommitted-changes row carries no commit metadata, so it cannot
    // match a filter; hide it too rather than leave it as a false result.
    const uncommittedRow = document.querySelector<HTMLElement>(".unsavedChanges");
    uncommittedRow?.classList.toggle("filterHidden", active);

    const rows = <HTMLCollectionOf<HTMLElement>>document.getElementsByClassName("commit");
    if (!active) {
      for (let i = 0; i < rows.length; i++) {
        rows[i].classList.remove("filterHidden");
      }
      this.findWidget.refresh();
      return;
    }

    const lower = text.toLowerCase();
    for (let i = 0; i < rows.length; i++) {
      const commit = this.commits[parseInt(rows[i].dataset.id ?? "", 10)];
      if (commit === undefined) {
        continue;
      }
      const match =
        commit.message.toLowerCase().includes(lower) ||
        commit.hash.toLowerCase().startsWith(lower) ||
        commit.author.toLowerCase().includes(lower) ||
        commit.email.toLowerCase().includes(lower);
      rows[i].classList.toggle("filterHidden", !match);
    }
    this.findWidget.refresh();
  }

  public renderRepoInProgress(state: RepoInProgressState | null) {
    this.repoInProgressBanner.render(state);
  }

  /**
   * Applies changed settings without reopening the view. `this.graph` reads
   * the same `config` object by reference (constructor), so mutating its
   * properties in place reaches both without reconstructing either.
   */
  public updateConfig(config: Partial<Config>) {
    Object.assign(this.config, config);
  }

  public refresh(hard: boolean) {
    if (hard) {
      if (this.expandedCommit !== null) {
        this.expandedCommit = null;
        this.saveState();
      }
      this.renderShowLoading();
    }
    this.requestLoadBranchesAndCommits(hard);
  }

  /* Requests */
  private requestLoadBranches(
    hard: boolean,
    loadedCallback: (changes: boolean, isRepo: boolean) => void
  ) {
    if (this.loadBranchesCallback !== null) {
      return;
    }
    this.loadBranchesCallback = loadedCallback;
    sendMessage({ command: "selectRepo", repo: this.currentRepo });
    sendMessage({
      command: "loadBranches",
      showRemoteBranches: this.showRemoteBranches,
      hard: hard
    });
  }
  /**
   * Moves the view to another repository.
   *
   * Selections describe the repository they came from, so they are cleared
   * here. Carrying a branch over would ask the new repository to log a ref it
   * does not have, which returns nothing and leaves the graph empty.
   */
  private changeRepo(path: string) {
    this.currentRepo = path;
    this.maxCommits = this.config.initialLoadCommits;
    this.expandedCommit = null;
    this.setSelectedBranches([]);
    this.gitBranches = [];
    this.gitBranchHead = null;
    this.saveState();
  }

  /** Keeps the multi-branch list and its single-branch view in step. */
  private setSelectedBranches(branches: readonly string[]) {
    this.currentBranches = [...branches];
    this.currentBranch = this.currentBranches.length > 0 ? this.currentBranches[0] : null;
  }

  private requestLoadCommits(hard: boolean, loadedCallback: (changes: boolean) => void) {
    if (this.loadCommitsCallback !== null) {
      return;
    }
    this.loadCommitsCallback = loadedCallback;
    sendMessage({
      command: "loadCommits",
      repo: this.currentRepo!,
      branchName: this.currentBranch !== null ? this.currentBranch : "",
      branches: this.currentBranches,
      maxCommits: this.maxCommits,
      showRemoteBranches: this.showRemoteBranches,
      hard: hard
    });
  }
  private requestLoadBranchesAndCommits(hard: boolean) {
    // Asked for on every refresh: the state changes outside the panel, when
    // the user runs a rebase or merge from a terminal.
    sendMessage({ command: "repoInProgress" });
    this.requestLoadBranches(hard, (branchChanges: boolean, isRepo: boolean) => {
      if (isRepo) {
        this.requestLoadCommits(hard, (commitChanges: boolean) => {
          if (!hard && (branchChanges || commitChanges)) {
            hideDialogAndContextMenu();
          }
        });
      } else {
        sendMessage({ command: "loadRepos", check: true });
      }
    });
  }
  private fetchAvatars(avatars: { [email: string]: string[] }) {
    let emails = Object.keys(avatars);
    for (let i = 0; i < emails.length; i++) {
      sendMessage({
        command: "fetchAvatar",
        repo: this.currentRepo!,
        email: emails[i],
        commits: avatars[emails[i]]
      });
    }
  }

  /* State */
  private saveState() {
    vscode.setState({
      gitRepos: this.gitRepos,
      gitBranches: this.gitBranches,
      gitBranchHead: this.gitBranchHead,
      commits: this.commits,
      commitHead: this.commitHead,
      avatars: this.avatars,
      currentBranch: this.currentBranch,
      currentBranches: this.currentBranches,
      currentRepo: this.currentRepo,
      moreCommitsAvailable: this.moreCommitsAvailable,
      maxCommits: this.maxCommits,
      showRemoteBranches: this.showRemoteBranches,
      expandedCommit: this.expandedCommit,
      filesPanelWidth: this.filesPanelWidth,
      branchPanel: this.branchPanel.getState(),
      fullDiffPanel: this.fullDiffPanel.getState()
    });
  }

  /* Renderers */
  private render() {
    this.renderTable();
    this.renderGraph();
  }
  private renderGraph() {
    let colHeadersElem = document.getElementById("tableColHeaders");
    if (colHeadersElem === null) {
      return;
    }
    let headerHeight = colHeadersElem.clientHeight + 1,
      expandedCommitElem =
        this.expandedCommit !== null ? document.getElementById("commitDetails") : null;
    this.config.grid.expandY =
      expandedCommitElem !== null
        ? expandedCommitElem.getBoundingClientRect().height
        : this.config.grid.expandY;
    this.config.grid.y =
      this.commits.length > 0
        ? (this.tableElem.children[0].clientHeight -
            headerHeight -
            (this.expandedCommit !== null ? this.config.grid.expandY : 0)) /
          this.commits.length
        : this.config.grid.y;
    this.config.grid.offsetY = headerHeight + this.config.grid.y / 2;
    this.graph.render(this.expandedCommit);
  }
  private renderTable() {
    const showCommitted = viewState.columnVisibility.Committed;
    const showId = viewState.columnVisibility.ID;
    // The graph is drawn over the left of the Graph column, so every message
    // starts past the widest lane instead of past its own. A per-row offset
    // would leave the messages ragged.
    const messageIndent = Math.max(this.graph.getWidth() + this.config.grid.offsetX, 0);
    // Read by #commitDetailsSummary so the expanded panel's text starts where
    // messages do, clear of the lanes still drawn behind it.
    this.tableElem.style.setProperty("--message-indent", messageIndent + "px");
    let html =
        `<tr id="tableColHeaders"><th class="tableColHeader">${l10n.graph}</th>` +
        (showCommitted ? `<th class="tableColHeader committedCol">${l10n.dev}</th>` : "") +
        (showId ? `<th class="tableColHeader idCol">${l10n.id}</th>` : "") +
        "</tr>",
      i;
    for (i = 0; i < this.commits.length; i++) {
      let refs = "",
        message = escapeHtml(this.commits[i].message),
        dateTitle = getCommitTitleDate(this.commits[i].date),
        dateCompact = getCompactCommitDate(this.commits[i].date),
        j,
        refName,
        refActive,
        refHtml;
      for (j = 0; j < this.commits[i].refs.length; j++) {
        refName = escapeHtml(this.commits[i].refs[j].name);
        refActive =
          this.commits[i].refs[j].type === "head" &&
          this.commits[i].refs[j].name === this.gitBranchHead;
        refHtml =
          this.commits[i].refs[j].type === "tag"
            ? renderTagPill(this.commits[i].refs[j].name)
            : '<span class="gitRef ' +
              this.commits[i].refs[j].type +
              (refActive ? " active" : "") +
              '" data-name="' +
              refName +
              '">' +
              svgIcons.branch +
              '<span class="gitRefName" data-fullref="' +
              refName +
              '">' +
              refName +
              "</span></span>";
        refs = refActive ? refHtml + refs : refs + refHtml;
      }
      html +=
        "<tr " +
        (this.commits[i].hash !== UNCOMMITTED
          ? 'class="commit' +
            (this.commits[i].hash === this.commitHead ? " head" : "") +
            '" data-hash="' +
            this.commits[i].hash +
            '"'
          : 'class="unsavedChanges"') +
        ' data-find-text="' +
        escapeHtml(
          [
            this.commits[i].message,
            this.commits[i].author,
            this.commits[i].email,
            this.commits[i].hash,
            ...this.commits[i].refs.map((ref) => ref.name)
          ].join(" ")
        ) +
        '" data-id="' +
        i +
        '" data-color="' +
        this.graph.getVertexColour(i) +
        // Ref labels, the HEAD dot and the row marker are all drawn in the
        // commit's own lane colour, so the row carries that colour itself.
        '" style="--git-graph-color:' +
        escapeHtml(this.laneColour(i)) +
        '"><td><span class="description" style="padding-left:' +
        messageIndent +
        'px">' +
        (this.commits[i].hash === this.commitHead ? '<span class="commitHeadDot"></span>' : "") +
        refs +
        (this.commits[i].hash === this.commitHead ? "<b>" + message + "</b>" : message) +
        "</span></td>" +
        (showCommitted
          ? '<td class="committedCol text" title="' +
            escapeHtml(this.commits[i].author + " • " + dateTitle) +
            '">' +
            renderAuthorVisualHtml(
              this.config,
              this.commits[i].author,
              this.commits[i].email,
              typeof this.avatars[this.commits[i].email] === "string"
                ? this.avatars[this.commits[i].email]
                : null
            ) +
            '<span class="committedMeta"><span class="committedDate">' +
            escapeHtml(dateCompact) +
            "</span></span></td>"
          : "") +
        (showId
          ? '<td class="idCol text" title="' +
            escapeHtml(this.commits[i].hash) +
            '">' +
            abbrevCommit(this.commits[i].hash) +
            "</td>"
          : "") +
        "</tr>";
    }
    this.tableElem.innerHTML = "<table>" + html + "</table>";
    this.footerElem.innerHTML = this.moreCommitsAvailable
      ? '<div id="loadMoreCommitsBtn" class="roundedBtn">' + l10n.loadMore + "</div>"
      : "";
    this.applyTableLayout();
    // Rendering replaces every row, so an active filter has to be re-applied
    // or a refresh or "load more" would silently reveal filtered-out commits.
    if (this.commitFilterText !== "") {
      this.applyCommitFilter(this.commitFilterText);
    }
    this.findWidget.refresh();

    if (this.moreCommitsAvailable) {
      document.getElementById("loadMoreCommitsBtn")!.addEventListener("click", () => {
        (<HTMLElement>document.getElementById("loadMoreCommitsBtn")!.parentNode!).innerHTML =
          '<h2 id="loadingHeader">' + svgIcons.loading + l10n.loading + "</h2>";
        this.maxCommits += this.config.loadMoreCommits;
        this.hideCommitDetails();
        this.saveState();
        this.requestLoadCommits(true, () => {});
      });
    }

    if (this.expandedCommit !== null) {
      let elem = null,
        elems = <HTMLCollectionOf<HTMLElement>>document.getElementsByClassName("commit");
      for (i = 0; i < elems.length; i++) {
        if (this.expandedCommit.hash === elems[i].dataset.hash) {
          elem = elems[i];
          break;
        }
      }
      if (elem === null) {
        this.expandedCommit = null;
        this.saveState();
      } else {
        this.expandedCommit.id = parseInt(elem.dataset.id!);
        this.expandedCommit.srcElem = elem;
        this.saveState();
        if (this.expandedCommit.commitDetails !== null && this.expandedCommit.fileTree !== null) {
          this.showCommitDetails(this.expandedCommit.commitDetails, this.expandedCommit.fileTree);
        } else {
          this.loadCommitDetails(elem);
        }
      }
    }

    addListenerToClass("commit", "contextmenu", (e: Event) => {
      e.stopPropagation();
      let sourceElem = <HTMLElement>(<Element>e.target).closest(".commit")!;
      let hash = sourceElem.dataset.hash!;
      showContextMenu(
        <MouseEvent>e,
        [
          {
            title: l10n.addTag + ELLIPSIS,
            onClick: () => {
              showFormDialog(
                l10n.dialogAddTagTitle.replace("{0}", "<b><i>" + abbrevCommit(hash) + "</i></b>"),
                [
                  { type: "text-ref" as const, name: l10n.dialogAddTagName, default: "" },
                  {
                    type: "select" as const,
                    name: l10n.dialogAddTagType,
                    default: "annotated",
                    options: [
                      { name: l10n.dialogAddTagTypeAnnotated, value: "annotated" },
                      { name: l10n.dialogAddTagTypeLightweight, value: "lightweight" }
                    ]
                  },
                  {
                    type: "text" as const,
                    name: l10n.dialogAddTagMessage,
                    default: "",
                    placeholder: l10n.dialogAddTagOptional
                  }
                ],
                l10n.dialogAddTagSubmit,
                (values) => {
                  sendMessage({
                    command: "addTag",
                    repo: this.currentRepo!,
                    tagName: values[0],
                    commitHash: hash,
                    lightweight: values[1] === "lightweight",
                    message: values[2]
                  });
                },
                sourceElem
              );
            }
          },
          {
            title: l10n.createBranch + ELLIPSIS,
            onClick: () => {
              showRefInputDialog(
                l10n.dialogCreateBranchTitle.replace(
                  "{0}",
                  "<b><i>" + abbrevCommit(hash) + "</i></b>"
                ),
                "",
                l10n.dialogCreateBranchSubmit,
                (name) => {
                  sendMessage({
                    command: "createBranch",
                    repo: this.currentRepo!,
                    branchName: name,
                    commitHash: hash
                  });
                },
                sourceElem
              );
            }
          },
          null,
          {
            title: l10n.checkout + ELLIPSIS,
            onClick: () => {
              showConfirmationDialog(
                l10n.dialogCheckoutConfirm.replace(
                  "{0}",
                  "<b><i>" + abbrevCommit(hash) + "</i></b>"
                ),
                () => {
                  sendMessage({
                    command: "checkoutCommit",
                    repo: this.currentRepo!,
                    commitHash: hash
                  });
                },
                sourceElem
              );
            }
          },
          {
            title: l10n.cherryPick + ELLIPSIS,
            onClick: () => {
              if (this.commits[this.commitLookup[hash]].parentHashes.length === 1) {
                showConfirmationDialog(
                  l10n.dialogCherryPickConfirm.replace(
                    "{0}",
                    "<b><i>" + abbrevCommit(hash) + "</i></b>"
                  ),
                  () => {
                    sendMessage({
                      command: "cherrypickCommit",
                      repo: this.currentRepo!,
                      commitHash: hash,
                      parentIndex: 0
                    });
                  },
                  sourceElem
                );
              } else {
                let options = this.commits[this.commitLookup[hash]].parentHashes.map(
                  (parentHash, index) => ({
                    name:
                      abbrevCommit(parentHash) +
                      (typeof this.commitLookup[parentHash] === "number"
                        ? ": " + this.commits[this.commitLookup[parentHash]].message
                        : ""),
                    value: (index + 1).toString()
                  })
                );
                showSelectDialog(
                  l10n.dialogCherryPickConfirm.replace(
                    "{0}",
                    "<b><i>" + abbrevCommit(hash) + "</i></b>"
                  ),
                  "1",
                  options,
                  l10n.dialogYesCherryPick,
                  (parentIndex) => {
                    sendMessage({
                      command: "cherrypickCommit",
                      repo: this.currentRepo!,
                      commitHash: hash,
                      parentIndex: parseInt(parentIndex)
                    });
                  },
                  sourceElem
                );
              }
            }
          },
          {
            title: l10n.revert + ELLIPSIS,
            onClick: () => {
              if (this.commits[this.commitLookup[hash]].parentHashes.length === 1) {
                showConfirmationDialog(
                  l10n.dialogRevertConfirm.replace(
                    "{0}",
                    "<b><i>" + abbrevCommit(hash) + "</i></b>"
                  ),
                  () => {
                    sendMessage({
                      command: "revertCommit",
                      repo: this.currentRepo!,
                      commitHash: hash,
                      parentIndex: 0
                    });
                  },
                  sourceElem
                );
              } else {
                let options = this.commits[this.commitLookup[hash]].parentHashes.map(
                  (parentHash, index) => ({
                    name:
                      abbrevCommit(parentHash) +
                      (typeof this.commitLookup[parentHash] === "number"
                        ? ": " + this.commits[this.commitLookup[parentHash]].message
                        : ""),
                    value: (index + 1).toString()
                  })
                );
                showSelectDialog(
                  l10n.dialogRevertConfirm.replace(
                    "{0}",
                    "<b><i>" + abbrevCommit(hash) + "</i></b>"
                  ),
                  "1",
                  options,
                  l10n.dialogYesRevert,
                  (parentIndex) => {
                    sendMessage({
                      command: "revertCommit",
                      repo: this.currentRepo!,
                      commitHash: hash,
                      parentIndex: parseInt(parentIndex)
                    });
                  },
                  sourceElem
                );
              }
            }
          },
          null,
          {
            title: l10n.merge + ELLIPSIS,
            onClick: () => {
              showCheckboxDialog(
                l10n.dialogMergeConfirm
                  .replace("{0}", `<b><i>${abbrevCommit(hash)}</i></b>`)
                  .replace("{1}", `<b>${l10n.labelCurrentBranch}</b>`),
                l10n.dialogMergeNoFastForward,
                true,
                l10n.dialogYesMerge,
                (createNewCommit) => {
                  sendMessage({
                    command: "mergeCommit",
                    repo: this.currentRepo!,
                    commitHash: hash,
                    createNewCommit: createNewCommit
                  });
                },
                null
              );
            }
          },
          {
            title: l10n.reset + ELLIPSIS,
            onClick: () => {
              showSelectDialog(
                l10n.dialogResetConfirm
                  .replace("{0}", `<b>${l10n.labelCurrentBranch}</b>`)
                  .replace("{1}", "<b><i>" + abbrevCommit(hash) + "</i></b>"),
                "mixed",
                [
                  { name: l10n.dialogResetSoft, value: "soft" },
                  { name: l10n.dialogResetMixed, value: "mixed" },
                  { name: l10n.dialogResetHard, value: "hard" }
                ],
                l10n.dialogYesReset,
                (mode) => {
                  sendMessage({
                    command: "resetToCommit",
                    repo: this.currentRepo!,
                    commitHash: hash,
                    resetMode: <GitResetMode>mode
                  });
                },
                sourceElem
              );
            }
          },
          null,
          {
            title: l10n.copyCommitHash,
            onClick: () => {
              sendMessage({ command: "copyToClipboard", type: "Commit Hash", data: hash });
            }
          }
        ],
        sourceElem
      );
    });
    addListenerToClass("commit", "click", (e: Event) => {
      const sourceElem = <HTMLElement>(<Element>e.target).closest(".commit")!;
      const hash = sourceElem.dataset.hash;
      if (hash === undefined) {
        return;
      }
      const gesture = readSelectionGesture(<MouseEvent>e);
      const hashes = this.commits.map((commit) => commit.hash);
      this.selection.apply(gesture, hashes.indexOf(hash), hashes);
      this.workingTreeOpen = false;
      this.renderSelection();

      // Clicking picks commits out; it never opens one. Opening is the double
      // click, so a first click can always be the start of a selection.
      if (this.selection.size() === 1 && this.selection.has(hash)) {
        this.previewCommitFiles(hash);
      }
    });
    // The uncommitted row opens on a single click: it is one row that always
    // means the same thing, so there is no selection to build up first.
    addListenerToClass("unsavedChanges", "click", () => this.openWorkingTree());
    addListenerToClass("commit", "dblclick", (e: Event) => {
      const sourceElem = <HTMLElement>(<Element>e.target).closest(".commit")!;
      const hash = sourceElem.dataset.hash;
      if (hash === undefined) {
        return;
      }
      if (this.expandedCommit !== null && this.expandedCommit.hash === hash) {
        this.hideCommitDetails();
      } else {
        this.loadCommitDetails(sourceElem);
      }
    });
    addListenerToClass("gitRef", "contextmenu", (e: Event) => {
      e.stopPropagation();
      let sourceElem = <HTMLElement>(<Element>e.target).closest(".gitRef")!;
      let refName = unescapeHtml(sourceElem.dataset.name!),
        menu: ContextMenuElement[],
        copyType: string,
        copyTitle: string;
      if (sourceElem.classList.contains("tag")) {
        menu = [
          {
            title: l10n.deleteTag + ELLIPSIS,
            onClick: () => {
              showConfirmationDialog(
                l10n.dialogDeleteConfirm
                  .replace("{0}", l10n.labelTag)
                  .replace("{1}", "<b><i>" + escapeHtml(refName) + "</i></b>"),
                () => {
                  sendMessage({ command: "deleteTag", repo: this.currentRepo!, tagName: refName });
                },
                null
              );
            }
          },
          {
            title: l10n.pushTag + ELLIPSIS,
            onClick: () => {
              showConfirmationDialog(
                l10n.dialogPushTagConfirm.replace(
                  "{0}",
                  "<b><i>" + escapeHtml(refName) + "</i></b>"
                ),
                () => {
                  sendMessage({ command: "pushTag", repo: this.currentRepo!, tagName: refName });
                  showActionRunningDialog(l10n.pushingTag);
                },
                null
              );
            }
          }
        ];
        copyType = "Tag Name";
        copyTitle = l10n.copyTagName;
      } else {
        if (sourceElem.classList.contains("head")) {
          menu = [];
          if (this.gitBranchHead !== refName) {
            menu.push({
              title: l10n.checkoutBranch,
              onClick: () => this.checkoutBranchAction(sourceElem, refName)
            });
          }
          menu.push({
            title: l10n.renameBranch + ELLIPSIS,
            onClick: () => {
              showRefInputDialog(
                l10n.dialogRenameBranchTitle.replace(
                  "{0}",
                  "<b><i>" + escapeHtml(refName) + "</i></b>"
                ),
                refName,
                l10n.dialogRenameBranchSubmit,
                (newName) => {
                  sendMessage({
                    command: "renameBranch",
                    repo: this.currentRepo!,
                    oldName: refName,
                    newName: newName
                  });
                },
                null
              );
            }
          });
          if (this.gitBranchHead !== refName) {
            menu.push(
              {
                title: l10n.deleteBranch + ELLIPSIS,
                onClick: () => {
                  showCheckboxDialog(
                    l10n.dialogDeleteConfirm
                      .replace("{0}", l10n.labelBranch)
                      .replace("{1}", "<b><i>" + escapeHtml(refName) + "</i></b>"),
                    l10n.dialogDeleteForceDelete,
                    false,
                    l10n.deleteBranch,
                    (forceDelete) => {
                      sendMessage({
                        command: "deleteBranch",
                        repo: this.currentRepo!,
                        branchName: refName,
                        forceDelete: forceDelete
                      });
                    },
                    null
                  );
                }
              },
              {
                title: l10n.merge + ELLIPSIS,
                onClick: () => {
                  showCheckboxDialog(
                    l10n.dialogMergeConfirm
                      .replace("{0}", "<b><i>" + escapeHtml(refName) + "</i></b>")
                      .replace("{1}", l10n.labelCurrentBranch),
                    l10n.dialogMergeNoFastForward,
                    true,
                    l10n.dialogYesMerge,
                    (createNewCommit) => {
                      sendMessage({
                        command: "mergeBranch",
                        repo: this.currentRepo!,
                        branchName: refName,
                        createNewCommit: createNewCommit
                      });
                    },
                    null
                  );
                }
              }
            );
          }
        } else {
          // A remote-tracking ref's name is "<remote>/<branch>"; the remote
          // name never contains a slash, so only the first one splits it.
          const slash = refName.indexOf("/");
          const remoteName = refName.slice(0, slash);
          const remoteBranchOnly = refName.slice(slash + 1);
          menu = [
            {
              title: l10n.checkoutBranch + ELLIPSIS,
              onClick: () => this.checkoutBranchAction(sourceElem, refName)
            },
            {
              title: l10n.merge + ELLIPSIS,
              onClick: () => {
                showCheckboxDialog(
                  l10n.dialogMergeConfirm
                    .replace("{0}", "<b><i>" + escapeHtml(refName) + "</i></b>")
                    .replace("{1}", l10n.labelCurrentBranch),
                  l10n.dialogMergeNoFastForward,
                  true,
                  l10n.dialogYesMerge,
                  (createNewCommit) => {
                    sendMessage({
                      command: "mergeBranch",
                      repo: this.currentRepo!,
                      branchName: refName,
                      createNewCommit: createNewCommit
                    });
                  },
                  null
                );
              }
            },
            {
              title: l10n.pullIntoCurrentBranch + ELLIPSIS,
              onClick: () => {
                showConfirmationDialog(
                  l10n.dialogPullBranchConfirm
                    .replace("{0}", "<b><i>" + escapeHtml(refName) + "</i></b>")
                    .replace("{1}", l10n.labelCurrentBranch),
                  () => {
                    sendMessage({
                      command: "pullBranch",
                      repo: this.currentRepo!,
                      remote: remoteName,
                      branchName: remoteBranchOnly
                    });
                  },
                  null
                );
              }
            },
            {
              title: l10n.deleteRemoteBranch + ELLIPSIS,
              onClick: () => {
                showConfirmationDialog(
                  l10n.dialogDeleteConfirm
                    .replace("{0}", l10n.labelBranch)
                    .replace("{1}", "<b><i>" + escapeHtml(refName) + "</i></b>"),
                  () => {
                    sendMessage({
                      command: "deleteRemoteBranch",
                      repo: this.currentRepo!,
                      remote: remoteName,
                      branchName: remoteBranchOnly
                    });
                  },
                  null
                );
              }
            }
          ];
        }
        copyType = "Branch Name";
        copyTitle = l10n.copyBranchName;
      }
      menu.push(null, {
        title: copyTitle,
        onClick: () => {
          sendMessage({ command: "copyToClipboard", type: copyType, data: refName });
        }
      });
      showContextMenu(<MouseEvent>e, menu, sourceElem);
    });
    addListenerToClass("gitRef", "click", (e: Event) => e.stopPropagation());
    addListenerToClass("gitRef", "dblclick", (e: Event) => {
      e.stopPropagation();
      hideDialogAndContextMenu();
      let sourceElem = <HTMLElement>(<Element>e.target).closest(".gitRef")!;
      this.checkoutBranchAction(sourceElem, unescapeHtml(sourceElem.dataset.name!));
    });
  }
  private renderUncommitedChanges() {
    let dateTitle = getCommitTitleDate(this.commits[0].date);
    let dateCompact = getCompactCommitDate(this.commits[0].date);
    document.getElementsByClassName("unsavedChanges")[0].innerHTML =
      '<td><span class="description"><b>' +
      escapeHtml(this.commits[0].message) +
      "</b></span></td>" +
      // The asterisks are placeholder display text for the Dev and ID columns,
      // which have no value until the changes are committed. They are
      // deliberately not UNCOMMITTED: that constant is the commit hash
      // sentinel, and the two only coincide by accident. Both cells are
      // omitted when their column is hidden, or this row would not line up
      // with the rest of the table.
      (viewState.columnVisibility.Committed
        ? '<td class="committedCol text" title="' +
          escapeHtml(dateTitle) +
          '"><span class="committedMeta"><span class="committedDate">' +
          escapeHtml(dateCompact) +
          "</span></span></td>"
        : "") +
      (viewState.columnVisibility.ID ? '<td class="idCol text" title="*">*</td>' : "");
  }
  private renderShowLoading() {
    hideDialogAndContextMenu();
    this.graph.clear();
    this.tableElem.innerHTML =
      '<h2 id="loadingHeader">' + svgIcons.loading + l10n.loading + "</h2>";
    this.footerElem.innerHTML = "";
  }
  private checkoutBranchAction(sourceElem: HTMLElement, refName: string) {
    if (sourceElem.classList.contains("head")) {
      sendMessage({
        command: "checkoutBranch",
        repo: this.currentRepo!,
        branchName: refName,
        remoteBranch: null
      });
    } else if (sourceElem.classList.contains("remote")) {
      let refNameComps = refName.split("/");
      showRefInputDialog(
        l10n.dialogCreateBranchTitle.replace(
          "{0}",
          "<b><i>" + escapeHtml(sourceElem.dataset.name!) + "</i></b>"
        ),
        refNameComps[refNameComps.length - 1],
        l10n.checkoutBranch,
        (newBranch) => {
          sendMessage({
            command: "checkoutBranch",
            repo: this.currentRepo!,
            branchName: newBranch,
            remoteBranch: refName
          });
        },
        null
      );
    }
  }
  /** Colour of a commit's graph lane, taken from the configured palette. */
  private laneColour(index: number): string {
    const colours = this.config.graphColours;
    return colours.length === 0 ? "" : colours[this.graph.getVertexColour(index) % colours.length];
  }

  /**
   * Column widths are fixed by the stylesheet and never user-resizable: the
   * graph/message column still absorbs whatever space the fixed columns
   * beside it do not need, so it is never narrowed to fit a column of its own.
   */
  private applyTableLayout() {
    this.graph.limitMaxWidth(-1);
  }

  /* Observers */
  private observeWindowSizeChanges() {
    let windowWidth = window.outerWidth,
      windowHeight = window.outerHeight;
    window.addEventListener("resize", () => {
      if (windowWidth === window.outerWidth && windowHeight === window.outerHeight) {
        this.renderGraph();
      } else {
        windowWidth = window.outerWidth;
        windowHeight = window.outerHeight;
      }
    });
  }
  private observeWebviewStyleChanges() {
    let fontFamily = getVSCodeStyle("--vscode-editor-font-family");
    new MutationObserver(() => {
      let ff = getVSCodeStyle("--vscode-editor-font-family");
      if (ff !== fontFamily) {
        fontFamily = ff;
        this.repoDropdown.refresh();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  }
  /**
   * `#branchPanelSidebar`, `#findWidget`, and `#filesPanel` all pin themselves
   * below `#topBar` via `--top-bar-height`, a CSS variable that only ever had
   * a hardcoded 35px guess -- nothing kept it in sync with the bar's real
   * rendered height. Anything that makes the bar taller than that guess (a
   * webfont glyph metric, a DPI rounding difference, a future wider row) then
   * paints over the sidebar instead of pushing it down, since the bar sits at
   * a higher z-index. A `ResizeObserver` keeps the variable true to the DOM
   * instead of a number nobody re-measures.
   *
   * Nothing inside `#topBar` may size itself from `--top-bar-height` (see the
   * comment above `#controls` in main.css) -- that would make the height
   * this reads depend on the variable it writes, and a real run of exactly
   * that ran away to thousands of pixels within a few callbacks. Rounded and
   * compared against the last value regardless, as a second, independent
   * guard: `getBoundingClientRect()` can return fractionally different
   * results across reads that describe the same visual layout, and writing
   * one of those on every callback would re-trigger the observer forever.
   */
  private observeTopBarHeight() {
    const topBar = document.getElementById("topBar");
    if (topBar === null) {
      return;
    }
    let lastHeight = -1;
    const sync = () => {
      const height = Math.round(topBar.getBoundingClientRect().height);
      if (height === lastHeight) {
        return;
      }
      lastHeight = height;
      document.body.style.setProperty("--top-bar-height", `${height}px`);
    };
    sync();
    new ResizeObserver(sync).observe(topBar);
  }
  private observeWebviewScroll() {
    let active = window.scrollY > 0;
    this.scrollShadowElem.className = active ? "active" : "";
    document.addEventListener("scroll", () => {
      if (active !== window.scrollY > 0) {
        active = window.scrollY > 0;
        this.scrollShadowElem.className = active ? "active" : "";
      }
    });
  }

  /* Commit Details */
  /** Lists a commit's changed files in the side panel without opening the row. */
  private previewCommitFiles(hash: string) {
    this.previewHash = hash;
    // A revision replaces the working tree in the panel, so a reply still in
    // flight for the tree must not paint over it.
    this.workingTreeOpen = false;
    sendMessage({ command: "commitDetails", repo: this.currentRepo!, commitHash: hash });
  }

  /**
   * Routes one commitDetails reply. The same request backs both opening a
   * commit and previewing its files, so the pending intent decides which.
   */
  public renderCommitDetails(commitDetails: GitCommitDetails, fileTree: GitFolder) {
    if (this.expandedCommit !== null && this.expandedCommit.hash === commitDetails.hash) {
      this.showCommitDetails(commitDetails, fileTree);
      return;
    }
    if (this.previewHash === commitDetails.hash) {
      this.fillFilesPanel(commitDetails, fileTree, commitDetails.hash);
    }
  }

  /**
   * Opens the working tree in the side panel.
   *
   * The uncommitted row is not a commit, so it has no details to expand; what
   * it has is a working tree, which the panel shows as its own surface.
   */
  private openWorkingTree() {
    this.selection.clear();
    this.comparison = null;
    this.previewHash = null;
    this.workingTreeOpen = true;
    this.renderSelection();
    this.hideCommitDetails();
    this.filesPanel.setContentLoading();
    this.filesPanel.show();
    sendMessage({ command: "workingTreeChanges", repo: this.currentRepo! });
  }

  /** Renders the working tree the host reported, while the panel still wants it. */
  public renderWorkingTreeChanges(changes: GitWorkingTreeChange[], error: string | null) {
    if (!this.workingTreeOpen) {
      return;
    }
    this.workingTree = changes;
    this.filesPanel.setContent(renderChangesPanel(changes, error));
    this.filesPanel.setFooter(renderChangesFooter(this.commitMessage, this.commitAmend));
    this.registerChangesPanelListeners();
    this.registerCommitListeners();
  }

  /**
   * Wires the commit surface. The message lives on the view rather than in the
   * textarea alone, so re-reading the tree after staging does not discard what
   * the user has typed.
   */
  private registerCommitListeners() {
    const message = document.getElementById("changesMessage");
    const amend = document.getElementById("changesAmend");
    const commit = document.getElementById("changesCommitBtn");
    message?.addEventListener("input", () => {
      this.commitMessage = (<HTMLTextAreaElement>message).value;
    });
    amend?.addEventListener("change", () => {
      this.commitAmend = (<HTMLInputElement>amend).checked;
    });
    commit?.addEventListener("click", () => {
      sendMessage({
        command: "commitChanges",
        repo: this.currentRepo!,
        message: this.commitMessage,
        amend: this.commitAmend
      });
    });
  }

  /**
   * Closes out a commit. On success the message is cleared and the graph is
   * re-read, so the new commit replaces the row the user was standing on.
   */
  public afterCommit(status: GitCommandStatus) {
    if (status !== null) {
      showErrorDialog(l10n.changesUnableToCommit, status, null);
      return;
    }
    this.commitMessage = "";
    this.commitAmend = false;
    if (this.workingTreeOpen) {
      sendMessage({ command: "workingTreeChanges", repo: this.currentRepo! });
    }
    this.refresh(true);
  }

  /**
   * Closes out a working-tree action: a failure is shown with Git's own words,
   * and either way the tree and the graph are re-read, because the change count
   * on the uncommitted row moves with it.
   */
  public afterWorkingTreeAction(status: GitCommandStatus, title: string) {
    if (status !== null) {
      showErrorDialog(title, status, null);
    }
    if (this.workingTreeOpen) {
      sendMessage({ command: "workingTreeChanges", repo: this.currentRepo! });
    }
    this.refresh(true);
  }

  /** A working-tree row opens in the docked panel, as a commit's file does. */
  private registerChangesPanelListeners() {
    addListenerToClass("changesFileBtn", "click", (e: Event) => {
      // The row itself opens the diff, so an action on it must not also open one.
      e.stopPropagation();
      const button = <HTMLElement>(<Element>e.target).closest(".changesFileBtn")!;
      const row = <HTMLElement>button.closest(".changesFile")!;
      const path = row.dataset.path;
      if (path === undefined) {
        return;
      }
      if (button.dataset.action === "stage") {
        sendMessage({ command: "stageFiles", repo: this.currentRepo!, files: [path] });
        return;
      }
      if (button.dataset.action === "unstage") {
        sendMessage({ command: "unstageFiles", repo: this.currentRepo!, files: [path] });
        return;
      }
      // Discarding is the one action Git cannot undo, so it is confirmed first.
      const untracked = row.dataset.status === "U";
      showConfirmationDialog(
        (untracked ? l10n.changesDiscardUntrackedConfirm : l10n.changesDiscardConfirm).replace(
          "{0}",
          `<b><i>${escapeHtml(path)}</i></b>`
        ),
        () => {
          sendMessage({
            command: "discardFiles",
            repo: this.currentRepo!,
            files: [path],
            untracked
          });
        },
        null
      );
    });
    addListenerToClass("changesFile", "click", (e: Event) => {
      const row = <HTMLElement>(<Element>e.target).closest(".changesFile")!;
      const path = row.dataset.path;
      if (path === undefined) {
        return;
      }
      const staged = row.dataset.staged === "true";
      const change = this.workingTree.find(
        (candidate) => candidate.path === path && candidate.staged === staged
      );
      this.fullDiffPanel.open(path);
      sendMessage({
        command: "fullDiffContent",
        repo: this.currentRepo!,
        fromHash: UNCOMMITTED,
        toHash: UNCOMMITTED,
        oldFilePath: change?.oldPath ?? path,
        newFilePath: path,
        // An untracked file has no old side at all, which is what "added" means
        // to the query.
        type: change?.status === "U" ? "A" : (change?.status ?? "M"),
        staged
      });
    });
  }

  /** Fills the side panel with one revision's changed files. */
  private fillFilesPanel(commitDetails: GitCommitDetails, fileTree: GitFolder, hash: string) {
    // A revision has nothing to commit, so the commit surface goes with it.
    this.filesPanel.setFooter("");
    this.filesPanel.setContent(
      generateGitFileTreeHtml(fileTree, commitDetails.fileChanges) + "</table>"
    );
    this.filesPanel.show();
    this.registerFileTreeListeners(fileTree, hash, hash);
  }

  private loadCommitDetails(sourceElem: HTMLElement) {
    this.hideCommitDetails();
    this.expandedCommit = {
      id: parseInt(sourceElem.dataset.id!),
      hash: sourceElem.dataset.hash!,
      srcElem: sourceElem,
      commitDetails: null,
      fileTree: null
    };
    this.saveState();
    sendMessage({
      command: "commitDetails",
      repo: this.currentRepo!,
      commitHash: sourceElem.dataset.hash!
    });
  }
  public hideCommitDetails() {
    if (this.expandedCommit !== null) {
      let elem = document.getElementById("commitDetails");
      if (typeof elem === "object" && elem !== null) {
        elem.remove();
      }
      if (typeof this.expandedCommit.srcElem === "object" && this.expandedCommit.srcElem !== null) {
        this.expandedCommit.srcElem.classList.remove("commitDetailsOpen");
      }
      this.expandedCommit = null;
      this.saveState();
      this.renderGraph();
    }
  }
  public showCommitDetails(commitDetails: GitCommitDetails, fileTree: GitFolder) {
    if (
      this.expandedCommit === null ||
      this.expandedCommit.srcElem === null ||
      this.expandedCommit.hash !== commitDetails.hash
    ) {
      return;
    }
    let elem = document.getElementById("commitDetails");
    if (typeof elem === "object" && elem !== null) {
      elem.remove();
    }

    this.expandedCommit.commitDetails = commitDetails;
    this.expandedCommit.fileTree = fileTree;
    this.expandedCommit.srcElem.classList.add("commitDetailsOpen");
    this.saveState();

    // The summary spans whatever columns the table currently shows, so hiding
    // one never leaves it short or stretching the table.
    const columnCount =
      1 +
      (viewState.columnVisibility.Committed ? 1 : 0) +
      (viewState.columnVisibility.ID ? 1 : 0);
    let newElem = document.createElement("tr"),
      html = `<td colspan="${columnCount}"><div id="commitDetailsSummary">`;
    html +=
      '<div class="commitDetailsSummaryTop' +
      (typeof this.avatars[commitDetails.email] === "string" ? " withAvatar" : "") +
      '"><div class="commitDetailsSummaryKeyValues">';
    html += detailRowHtml(l10n.detailCommit, escapeHtml(commitDetails.hash));
    html += detailRowHtml(l10n.detailParents, commitDetails.parents.join(", "));
    html += detailRowHtml(
      l10n.detailAuthor,
      escapeHtml(commitDetails.author) +
        ' &lt;<a href="mailto:' +
        encodeURIComponent(commitDetails.email) +
        '">' +
        escapeHtml(commitDetails.email) +
        "</a>&gt;"
    );
    html += detailRowHtml(l10n.detailDate, new Date(commitDetails.date * 1000).toString());
    html += detailRowHtml(l10n.detailCommitter, escapeHtml(commitDetails.committer));
    html += "</div>";
    if (typeof this.avatars[commitDetails.email] === "string") {
      html +=
        '<div class="commitDetailsSummaryAvatar"><img src="' +
        this.avatars[commitDetails.email] +
        '"></div>';
    }
    html += "</div>";
    html +=
      '<div class="commitDetailsSummaryBody">' +
      escapeHtml(commitDetails.body).replace(/\n/g, "<br>") +
      "</div></div>";
    // The changed files live in the side panel only. Rendering the same tree
    // inline as well gave two copies of one list, and the inline copy is the
    // one with no room for it.
    html += '<div id="commitDetailsClose">' + svgIcons.close + "</div>";
    html += "</td>";

    newElem.id = "commitDetails";
    newElem.innerHTML = html;
    insertAfter(newElem, this.expandedCommit.srcElem);

    this.renderGraph();

    if (this.config.autoCenterCommitDetailsView) {
      // Center Commit Detail View setting is enabled
      // control menu height [40px] + newElem.y + (commit details view height [250px] + commit height [24px]) / 2 - (window height) / 2
      window.scrollTo(0, newElem.offsetTop + 177 - window.innerHeight / 2);
    } else if (newElem.offsetTop + 8 < window.pageYOffset) {
      // Commit Detail View is opening above what is visible on screen
      // control menu height [40px] + newElem y - commit height [24px] - desired gap from top [8px] < pageYOffset
      window.scrollTo(0, newElem.offsetTop + 8);
    } else if (
      newElem.offsetTop + this.config.grid.expandY - window.innerHeight + 48 >
      window.pageYOffset
    ) {
      // Commit Detail View is opening below what is visible on screen
      // control menu height [40px] + newElem y + commit details view height [250px] + desired gap from bottom [8px] - window height > pageYOffset
      window.scrollTo(0, newElem.offsetTop + this.config.grid.expandY - window.innerHeight + 48);
    }

    document.getElementById("commitDetailsClose")!.addEventListener("click", () => {
      this.hideCommitDetails();
    });

    // The side panel is the only place the change list appears.
    this.fillFilesPanel(commitDetails, fileTree, this.expandedCommit.hash);
  }

  /**
   * Wires the changed-file list in the side panel. The revisions are passed in
   * because the same list serves one commit and a two-commit comparison.
   */
  private registerFileTreeListeners(fileTree: GitFolder, fromHash: string, toHash: string) {
    addListenerToClass("gitFolder", "click", (e) => {
      const sourceElem = <HTMLElement>(<Element>e.target!).closest(".gitFolder");
      const parent = sourceElem.parentElement!;
      parent.classList.toggle("closed");
      const isOpen = !parent.classList.contains("closed");
      parent.children[0].children[0].innerHTML = isOpen
        ? svgIcons.openFolder
        : svgIcons.closedFolder;
      parent.children[1].classList.toggle("hidden");
      alterGitFileTree(fileTree, decodeURIComponent(sourceElem.dataset.folderpath!), isOpen);
      this.saveState();
    });
    // A single click shows the file in the docked panel; a double click hands
    // it to the editor's own diff view, which is the only way to edit it.
    addListenerToClass("gitFile", "click", (e) => {
      const file = readClickedFile(e);
      if (file === null) {
        return;
      }
      this.fullDiffPanel.open(file.newFilePath);
      sendMessage({
        command: "fullDiffContent",
        repo: this.currentRepo!,
        fromHash,
        toHash,
        oldFilePath: file.oldFilePath,
        newFilePath: file.newFilePath,
        type: file.type
      });
    });
    addListenerToClass("gitFile", "dblclick", (e) => {
      const file = readClickedFile(e);
      if (file === null) {
        return;
      }
      sendMessage({
        command: "viewDiff",
        repo: this.currentRepo!,
        commitHash: toHash,
        oldFilePath: file.oldFilePath,
        newFilePath: file.newFilePath,
        type: file.type
      });
    });
  }
}

/** The change a click landed on, or null when the row has no viewable diff. */
function readClickedFile(e: Event) {
  const sourceElem = <HTMLElement>(<Element>e.target).closest(".gitFile")!;
  if (!sourceElem.classList.contains("gitDiffPossible")) {
    return null;
  }
  return {
    oldFilePath: decodeURIComponent(sourceElem.dataset.oldfilepath!),
    newFilePath: decodeURIComponent(sourceElem.dataset.newfilepath!),
    type: <GitFileChangeType>sourceElem.dataset.type
  };
}

// Mutable so `applyLiveSettings` can rebind the chord without tearing down
// and re-registering `observeRefreshShortcut`'s own listener.
let refreshShortcutKey = viewState.refreshShortcutKey;

/**
 * Refreshes on the configured Ctrl/Cmd chord. Registered on the document
 * because the panel has no single focusable root, and skipped while a text
 * field has focus so it cannot swallow a keystroke meant for typing.
 */
function observeRefreshShortcut(view: GitGraphView) {
  document.addEventListener("keydown", (e) => {
    if (refreshShortcutKey === null) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === refreshShortcutKey) {
      view.refresh(true);
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

// Excludes `grid`: `renderGraph()` recomputes its y/expandY/offsetY from live
// DOM measurements on every render, so a config update must leave whatever
// is already on `this.config.grid` alone rather than resetting it to a
// stale default between updateConfig() and the next render pass.
function configFromViewState(): Omit<Config, "grid"> {
  return {
    autoCenterCommitDetailsView: viewState.autoCenterCommitDetailsView,
    committedVisual: viewState.committedVisual,
    avatarMode: viewState.avatarMode,
    avatarSize: viewState.avatarSize,
    avatarShape: viewState.avatarShape,
    fetchAvatars: viewState.fetchAvatars,
    graphColours: viewState.graphColours,
    graphStyle: viewState.graphStyle,
    initialLoadCommits: viewState.initialLoadCommits,
    loadMoreCommits: viewState.loadMoreCommits,
    showCurrentBranchByDefault: viewState.showCurrentBranchByDefault
  };
}

// Density is a body class so it applies to everything the stylesheet scopes
// under it, without each renderer having to know the setting.
function applyUiDensity(density: GG.GitGraphViewState["uiDensity"]) {
  document.body.classList.remove("compactUi", "extraCompactUi");
  if (density === "Normal") {
    document.body.classList.add("compactUi");
  } else if (density === "Compact") {
    document.body.classList.add("compactUi", "extraCompactUi");
  }
}
applyUiDensity(viewState.uiDensity);

let gitGraph!: GitGraphView;

/** Builds the view. The host installs its transport before calling this. */
export function startCommitsView() {
  gitGraph = new GitGraphView(
    viewState.repos,
    viewState.lastActiveRepo,
    { ...configFromViewState(), grid: { x: 16, y: 24, offsetX: 8, offsetY: 12, expandY: 250 } },
    vscode.getState()
  );
  observeExternalUrls();
  observeRefreshShortcut(gitGraph);
}

/**
 * Re-applies the current global `viewState` to the already-built view, for a
 * host that lets settings take effect without reopening the page. No-op
 * before `startCommitsView` has run.
 */
export function applyLiveSettings(): void {
  refreshShortcutKey = viewState.refreshShortcutKey;
  applyUiDensity(viewState.uiDensity);
  gitGraph?.updateConfig(configFromViewState());
  gitGraph?.refresh(false);
}

/* Command Processing */
window.addEventListener("message", (event) => {
  const msg: GG.ResponseMessage = event.data;
  switch (msg.command) {
    case "addTag":
      refreshGraphOrDisplayError(msg.status, l10n.unableToAddTag);
      break;
    case "checkoutBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToCheckoutBranch);
      break;
    case "checkoutCommit":
      refreshGraphOrDisplayError(msg.status, l10n.unableToCheckoutCommit);
      break;
    case "cherrypickCommit":
      refreshGraphOrDisplayError(msg.status, l10n.unableToCherryPick);
      break;
    case "commitDetails":
      if (msg.commitDetails === null) {
        gitGraph.hideCommitDetails();
        showErrorDialog(l10n.unableToLoadCommitDetails, null, null);
      } else {
        gitGraph.renderCommitDetails(
          msg.commitDetails,
          generateGitFileTree(msg.commitDetails.fileChanges)
        );
      }
      break;
    case "copyToClipboard":
      if (msg.success === false) {
        let typeLabel: Record<string, string> = {
          "Commit Hash": l10n.typeCommitHash,
          "Tag Name": l10n.typeTagName,
          "Branch Name": l10n.typeBranchName,
          "Selection": l10n.typeSelection
        };
        showErrorDialog(
          l10n.unableToCopyToClipboard.replace("{0}", typeLabel[msg.type] ?? msg.type),
          null,
          null
        );
      }
      break;
    case "createBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToCreateBranch);
      break;
    case "deleteBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToDeleteBranch);
      break;
    case "deleteTag":
      refreshGraphOrDisplayError(msg.status, l10n.unableToDeleteTag);
      break;
    case "fetchAvatar":
      gitGraph.loadAvatar(msg.email, msg.image);
      break;
    case "loadBranches":
      gitGraph.loadBranches(msg.branches, msg.head, msg.hard, msg.isRepo, {
        upstreams: msg.upstreams ?? {},
        remotes: msg.remotes ?? {}
      });
      break;
    case "repoInProgress":
      gitGraph.renderRepoInProgress(msg.state);
      break;
    case "inProgressAction":
      if (msg.status === null) {
        gitGraph.refresh(true);
      } else {
        showErrorDialog(l10n.repoInProgressActionFailed, msg.status, null);
      }
      break;
    case "commitComparison":
      gitGraph.renderComparison(msg.fileChanges, msg.error);
      break;
    case "fullDiffContent":
      gitGraph.renderFullDiff(msg);
      break;
    case "loadCommits":
      gitGraph.loadCommits(msg.commits, msg.head, msg.moreCommitsAvailable, msg.hard);
      break;
    case "loadRepos":
      gitGraph.loadRepos(msg.repos, msg.lastActiveRepo);
      break;
    case "workingTreeChanges":
      gitGraph.renderWorkingTreeChanges(msg.changes, msg.error);
      break;
    case "stageFiles":
      gitGraph.afterWorkingTreeAction(msg.status, l10n.changesUnableToStage);
      break;
    case "unstageFiles":
      gitGraph.afterWorkingTreeAction(msg.status, l10n.changesUnableToUnstage);
      break;
    case "discardFiles":
      gitGraph.afterWorkingTreeAction(msg.status, l10n.changesUnableToDiscard);
      break;
    case "commitChanges":
      gitGraph.afterCommit(msg.status);
      break;
    case "mergeBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToMergeBranch);
      break;
    case "mergeCommit":
      refreshGraphOrDisplayError(msg.status, l10n.unableToMergeCommit);
      break;
    case "pushTag":
      refreshGraphOrDisplayError(msg.status, l10n.unableToPushTag);
      break;
    case "renameBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToRenameBranch);
      break;
    case "refresh":
      gitGraph.refresh(false);
      break;
    case "remoteOperation": {
      const remoteOperationErrors = { fetch: l10n.unableToFetch, pull: l10n.unableToPull, push: l10n.unableToPush };
      refreshGraphOrDisplayError(msg.status, remoteOperationErrors[msg.operation]);
      break;
    }
    case "pullBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToPull);
      break;
    case "deleteRemoteBranch":
      refreshGraphOrDisplayError(msg.status, l10n.unableToDeleteRemoteBranch);
      break;
    case "resetToCommit":
      refreshGraphOrDisplayError(msg.status, l10n.unableToReset);
      break;
    case "revertCommit":
      refreshGraphOrDisplayError(msg.status, l10n.unableToRevert);
      break;
    case "viewDiff":
      if (msg.success === false) {
        showErrorDialog(l10n.unableToViewDiff, null, null);
      }
      break;
    case "openExternalUrl":
      if (msg.error !== null) {
        showErrorDialog(l10n.unableToOpenUrl, msg.error, null);
      }
      break;
  }
});
function refreshGraphOrDisplayError(status: GitCommandStatus, errorMessage: string) {
  if (status === null) {
    gitGraph.refresh(true);
  } else {
    showErrorDialog(errorMessage, status, null);
  }
}

/* Dates */
/** Full date and time for the committedCol tooltip, independent of the compact display. */
function getCommitTitleDate(dateVal: number): string {
  const date = new Date(dateVal * 1000);
  const dateStr = formatShortDate(date, viewState.locale);
  const timeStr = pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  return dateStr + " " + timeStr;
}

/**
 * The Dev column's fixed-width display: a commit made today shows a locale-
 * and setting-aware time, so same-day activity reads at a glance; anything
 * older shows an unambiguous, always-10-character ISO date instead, so the
 * column's width never depends on which row is showing.
 */
function getCompactCommitDate(dateVal: number): string {
  const date = new Date(dateVal * 1000);
  return isSameLocalDay(date, new Date())
    ? formatShortTime(date, viewState.locale, viewState.timeFormat)
    : formatIsoDate(date);
}

/* Utils */

/**
 * Render a commit-detail row from a "Label: {0}" l10n template.
 * The text before {0} is the label and is rendered bold; valueHtml replaces {0}.
 */
function detailRowHtml(template: string, valueHtml: string) {
  const parts = template.split("{0}");
  return (
    '<div class="commitDetailsSummaryRow"><span class="commitDetailsSummaryLabel">' +
    parts[0] +
    '</span><span class="commitDetailsSummaryValue">' +
    valueHtml +
    (parts[1] ?? "") +
    "</span></div>"
  );
}

function generateGitFileTree(gitFiles: GitFileChange[]) {
  return buildFileTree(gitFiles.map((gitFile) => gitFile.newFilePath));
}
/**
 * One row of a commit's file list. The shared tree owns the folders around it;
 * this owns only what the row itself says, which is the part the working tree's
 * changes panel renders differently while keeping the same tree.
 */
function renderCommitFileRow(gitFile: GitFileChange, name: string): string {
  return (
    '<li class="gitFile ' +
    gitFile.type +
    (gitFile.additions !== null && gitFile.deletions !== null ? " gitDiffPossible" : "") +
    '" data-oldfilepath="' +
    encodeURIComponent(gitFile.oldFilePath) +
    '" data-newfilepath="' +
    encodeURIComponent(gitFile.newFilePath) +
    '" data-type="' +
    gitFile.type +
    '"' +
    (gitFile.additions === null || gitFile.deletions === null
      ? ' title="' + l10n.tooltipBinaryFile + '"'
      : "") +
    '><span class="gitFileIcon">' +
    (resolveFileIcon(viewState.fileIcons, name) ?? svgIcons.file) +
    '</span><span class="gitFileName">' +
    escapeHtml(name) +
    "</span>" +
    (gitFile.type === "R"
      ? ' <span class="gitFileRename" title="' +
        escapeHtml(
          l10n.tooltipRenamedTo
            .replace("{0}", gitFile.oldFilePath)
            .replace("{1}", gitFile.newFilePath)
        ) +
        '">R</span>'
      : "") +
    renderGitFileAddDel(gitFile) +
    "</li>"
  );
}
function generateGitFileTreeHtml(folder: GitFolder, gitFiles: GitFileChange[]) {
  return renderFileTree(folder, (index, name) => renderCommitFileRow(gitFiles[index], name));
}
/**
 * The change count beside a file's name: a binary file (additions/deletions
 * null) shows nothing, an added or deleted file shows only the side that
 * applies to it, and anything else shows both.
 */
function renderGitFileAddDel(gitFile: GitFileChange): string {
  if (gitFile.additions === null || gitFile.deletions === null) {
    return "";
  }
  const additionsTitle = (gitFile.additions !== 1
    ? l10n.tooltipAdditions
    : l10n.tooltipAddition
  ).replace("{0}", String(gitFile.additions));
  const deletionsTitle = (gitFile.deletions !== 1
    ? l10n.tooltipDeletions
    : l10n.tooltipDeletion
  ).replace("{0}", String(gitFile.deletions));
  const additionsHtml =
    '<span class="gitFileAdditions" title="' + additionsTitle + '">+' + gitFile.additions + "</span>";
  const deletionsHtml =
    '<span class="gitFileDeletions" title="' + deletionsTitle + '">-' + gitFile.deletions + "</span>";
  if (gitFile.type === "A") {
    return '<span class="gitFileAddDel">(' + additionsHtml + ")</span>";
  }
  if (gitFile.type === "D") {
    return '<span class="gitFileAddDel">(' + deletionsHtml + ")</span>";
  }
  return '<span class="gitFileAddDel">(' + additionsHtml + "|" + deletionsHtml + ")</span>";
}
function alterGitFileTree(folder: GitFolder, folderPath: string, open: boolean) {
  let path = folderPath.split("/"),
    i,
    cur = folder;
  for (i = 0; i < path.length; i++) {
    if (typeof cur.contents[path[i]] !== "undefined") {
      cur = <GitFolder>cur.contents[path[i]];
      if (i === path.length - 1) {
        cur.open = open;
        return;
      }
    } else {
      return;
    }
  }
}
/* Context Menu */

/* Global Listeners */
document.addEventListener("keyup", (e) => {
  if (e.key !== "Escape") {
    return;
  }
  // Escape unwinds one layer at a time, innermost first, so it never throws
  // away more than the user asked it to.
  if (isDialogOpen() || isContextMenuOpen()) {
    hideDialogAndContextMenu();
    return;
  }
  gitGraph.dismissTopLayer();
});
document.addEventListener("click", hideContextMenuIfOpen);
document.addEventListener("mouseleave", hideContextMenuIfOpen);
/**
 * Falls back for any right-click none of the app's own context menus already
 * claimed (they each call preventDefault() themselves via showContextMenu,
 * which runs first during bubbling since they're bound closer to the
 * target). Selected text gets a minimal Copy-only menu; anything else is
 * swallowed outright, so the host's native context menu (Print, Send tab to
 * your devices, …) never appears.
 */
document.addEventListener("contextmenu", (e) => {
  hideContextMenuIfOpen();
  if (e.defaultPrevented) return;
  const selectedText = window.getSelection()?.toString() ?? "";
  if (selectedText !== "") {
    showContextMenu(
      <MouseEvent>e,
      [{ title: l10n.copySelection, onClick: () => sendMessage({ command: "copyToClipboard", type: "Selection", data: selectedText }) }],
      <HTMLElement>e.target
    );
  } else {
    e.preventDefault();
  }
});

/** Closes whichever of the two overlays is open, so Escape dismisses either. */
function hideDialogAndContextMenu() {
  if (isDialogOpen()) {
    hideDialog();
  }
  hideContextMenuIfOpen();
}
