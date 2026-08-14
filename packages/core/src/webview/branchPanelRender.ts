import {
  TAG_PREFIX,
  type BranchPanelHead,
  type BranchPanelRemoteInfo,
  type BranchPanelRenderModel,
  type BranchPanelRenderOption
} from "./branchPanel";
import { abbrevCommit } from "./utils/git";
import { escapeHtml } from "./utils/html";

const REMOTE_PREFIX = "remotes/";

type BranchTreeNode = BranchTreeFolder | BranchTreeLeaf;

interface BranchTreeFolder {
  type: "folder";
  name: string;
  path: string;
  children: BranchTreeNode[];
}

interface BranchTreeLeaf {
  type: "leaf";
  displayName: string;
  fullName: string;
  option: BranchPanelRenderOption;
}

function insertNode(
  nodes: BranchTreeNode[],
  parts: string[],
  option: BranchPanelRenderOption,
  pathPrefix: string
): void {
  const segment = parts[0];
  const path = pathPrefix === "" ? segment : `${pathPrefix}/${segment}`;
  if (parts.length === 1) {
    nodes.push({ type: "leaf", displayName: segment, fullName: option.name, option });
    return;
  }

  let folder = nodes.find(
    (node): node is BranchTreeFolder => node.type === "folder" && node.name === segment
  );
  if (!folder) {
    folder = { type: "folder", name: segment, path, children: [] };
    nodes.push(folder);
  }
  insertNode(folder.children, parts.slice(1), option, path);
}

/**
 * The section key prefixes every folder path, because the two sections build
 * separate trees and a shared collapse set would otherwise fold a local and a
 * remote folder of the same name together.
 */
function buildTree(
  options: readonly BranchPanelRenderOption[],
  sectionKey: string
): BranchTreeNode[] {
  const root: BranchTreeNode[] = [];
  for (const option of options) {
    insertNode(root, option.name.split("/"), option, sectionKey);
  }
  return root;
}

function sortTree(nodes: BranchTreeNode[], groupsFirst: boolean): BranchTreeNode[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      node.children = sortTree(node.children, groupsFirst);
    }
  }
  return nodes.toSorted((left, right) => {
    if (groupsFirst && left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    const leftName = left.type === "folder" ? left.name : left.displayName;
    const rightName = right.type === "folder" ? right.name : right.displayName;
    return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
  });
}

/**
 * Folds a folder holding exactly one folder into its child, so a chain like
 * `release` → `7.0` renders as the single row `release/7.0`.
 */
function flattenSingleChildFolders(nodes: BranchTreeNode[]): BranchTreeNode[] {
  return nodes.map((node) => {
    if (node.type !== "folder") {
      return node;
    }
    let folder: BranchTreeFolder = { ...node, children: flattenSingleChildFolders(node.children) };
    while (folder.children.length === 1 && folder.children[0].type === "folder") {
      const only = folder.children[0];
      folder = { ...only, name: `${folder.name}/${only.name}` };
    }
    return folder;
  });
}

function renderCheck(selected: boolean): string {
  return `<span class="branchPanelCheck">${selected ? "✓" : ""}</span>`;
}

/**
 * Full ref the row stands for. A remote row carries only what its section
 * header does not, so the whole name has to come back from the value.
 */
function itemTitle(option: BranchPanelRenderOption): string {
  return option.value.startsWith(REMOTE_PREFIX)
    ? option.value.slice(REMOTE_PREFIX.length)
    : option.name;
}

/**
 * How a local branch names the upstream it tracks. A branch tracking the same
 * name on a remote shows only the remote, which is what makes the common case
 * short; anything else names the whole upstream ref.
 */
function trackingLabel(option: BranchPanelRenderOption, upstreams: BranchPanelRemoteInfo["upstreams"]): string {
  if (option.value === "" || option.value.startsWith(REMOTE_PREFIX)) {
    return "";
  }
  const upstream = upstreams[option.value];
  if (upstream === undefined || upstream === "") {
    return "";
  }
  const slash = upstream.lastIndexOf(`/${option.value}`);
  const remote = slash > 0 ? upstream.slice(0, slash) : "";
  return `= ${remote === "" ? upstream : remote}`;
}

function renderItem(
  option: BranchPanelRenderOption,
  name: string,
  indent: number,
  upstreams: BranchPanelRemoteInfo["upstreams"] = {}
): string {
  const classes = ["branchPanelItem"];
  if (option.selected) {
    classes.push("selected");
  }
  if (option.current) {
    classes.push("currentBranch");
  }
  const tracking = trackingLabel(option, upstreams);
  return `<div class="${classes.join(" ")}" data-value="${escapeHtml(option.value)}" title="${escapeHtml(itemTitle(option))}" style="padding-left:${4 + indent * 14}px">
    ${renderCheck(option.selected)}
    ${option.current ? '<span class="branchPanelCurrentMarker">▶</span>' : ""}
    <span class="branchPanelItemName">${escapeHtml(name)}</span>
    ${tracking === "" ? "" : `<span class="branchPanelTracking">${escapeHtml(tracking)}</span>`}
  </div>`;
}

/**
 * The checked-out revision, at the top of the panel where a Git client shows
 * it. Clicking the row selects the current branch; a detached HEAD has no
 * branch to select, so the row only reports where HEAD sits.
 */
function renderHeadRow(head: BranchPanelHead, current: BranchPanelRenderOption | undefined): string {
  if (head.branch === null && head.hash === null) {
    return "";
  }
  const classes = ["branchPanelItem", "branchPanelHeadRow"];
  if (current?.selected === true) {
    classes.push("selected");
  }
  const value = current === undefined ? "" : ` data-value="${escapeHtml(current.value)}"`;
  const hash =
    head.hash === null
      ? ""
      : `<span class="branchPanelHeadHash">(${escapeHtml(abbrevCommit(head.hash))})</span>`;
  return `<div class="${classes.join(" ")}"${value} title="${escapeHtml(head.branch ?? head.hash ?? "")}" style="padding-left:4px">
    ${renderCheck(current?.selected === true)}
    <span class="branchPanelItemName">HEAD</span>
    ${hash}
  </div>`;
}

function renderTree(
  nodes: readonly BranchTreeNode[],
  indent: number,
  collapsed: ReadonlySet<string>,
  upstreams: BranchPanelRemoteInfo["upstreams"]
): string {
  let html = "";
  for (const node of nodes) {
    if (node.type === "leaf") {
      html += renderItem(node.option, node.displayName, indent, upstreams);
      continue;
    }
    const isCollapsed = collapsed.has(node.path);
    html += `<div class="branchPanelFolder" data-folder="${escapeHtml(node.path)}" style="padding-left:${4 + indent * 14}px">
      <span class="branchPanelTwisty">${isCollapsed ? "▸" : "▾"}</span>
      <span class="branchPanelFolderName">${escapeHtml(node.name)}</span>
    </div>`;
    if (!isCollapsed) {
      html += renderTree(node.children, indent + 1, collapsed, upstreams);
    }
  }
  return html;
}

function renderSection(
  label: string,
  sectionKey: string,
  options: readonly BranchPanelRenderOption[],
  model: BranchPanelRenderModel,
  detail = ""
): string {
  if (options.length === 0) {
    return "";
  }
  let tree = sortTree(buildTree(options, sectionKey), model.groupsFirst);
  if (model.flattenSingleChildGroups) {
    tree = flattenSingleChildFolders(tree);
  }
  const url =
    detail === "" ? "" : `<span class="branchPanelRemoteUrl">${escapeHtml(detail)}</span>`;
  // The name and its count are one unbreakable unit; only the detail beside
  // them gives way when the sidebar is narrow.
  const name = `<span class="branchPanelSectionName">${escapeHtml(label)} (${options.length})</span>`;
  // The header folds through the same mechanism as the folders beneath it: the
  // section key can never collide with a folder path, because every folder path
  // is already prefixed with it.
  const collapsed = model.collapsedFolders.has(sectionKey);
  const header =
    `<div class="branchPanelSectionHeader branchPanelFolder" data-folder="${escapeHtml(sectionKey)}">` +
    `<span class="branchPanelTwisty">${collapsed ? "▸" : "▾"}</span>${name}${url}</div>`;
  return collapsed
    ? header
    : header + renderTree(tree, 1, model.collapsedFolders, model.remoteInfo.upstreams);
}

/**
 * One section per remote, named after the remote itself, so its refs sit under
 * `origin` rather than nesting every remote below one shared folder.
 */
function renderRemoteSections(
  remotes: readonly BranchPanelRenderOption[],
  model: BranchPanelRenderModel
): string {
  const byRemote = new Map<string, BranchPanelRenderOption[]>();
  for (const option of remotes) {
    const path = option.value.slice(REMOTE_PREFIX.length);
    const slash = path.indexOf("/");
    const remote = slash < 0 ? path : path.slice(0, slash);
    // The section header carries the remote, so the rows below it show only
    // what distinguishes them.
    const name = slash < 0 ? path : path.slice(slash + 1);
    const options = byRemote.get(remote) ?? [];
    options.push({ ...option, name });
    byRemote.set(remote, options);
  }
  return Array.from(byRemote.keys())
    .toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((remote) =>
      renderSection(
        remote,
        `remote:${remote}`,
        byRemote.get(remote)!,
        model,
        model.remoteInfo.remotes[remote] ?? ""
      )
    )
    .join("");
}

/** Builds the branch-panel list without attaching interaction behavior. */
export function renderBranchPanel(model: BranchPanelRenderModel): string {
  if (model.options.length === 0) {
    return `<div class="branchPanelEmpty">${escapeHtml(l10n.branchPanelNoBranches)}</div>`;
  }

  const filter = model.filter.trim().toLocaleLowerCase();
  const matches = (option: BranchPanelRenderOption) =>
    filter === "" || option.name.toLocaleLowerCase().includes(filter);
  const showAll = model.options.find(
    (option) =>
      option.value === "" && (filter === "" || l10n.showAll.toLocaleLowerCase().includes(filter))
  );
  const locals = model.options.filter(
    (option) =>
      option.value !== "" &&
      !option.value.startsWith(REMOTE_PREFIX) &&
      !option.value.startsWith(TAG_PREFIX) &&
      matches(option)
  );
  const remotes = model.options.filter(
    (option) => option.value.startsWith(REMOTE_PREFIX) && matches(option)
  );
  const tags = model.options.filter(
    (option) => option.value.startsWith(TAG_PREFIX) && matches(option)
  );
  // While a filter narrows the panel to matching refs, the two rows that are
  // not refs would only be noise.
  const head =
    filter === ""
      ? renderHeadRow(
          model.head,
          model.options.find((option) => option.current)
        )
      : "";

  return (
    head +
      (showAll ? renderItem(showAll, showAll.name, 0) : "") +
      renderSection(l10n.branchPanelLocalBranches, "local", locals, model) +
      renderRemoteSections(remotes, model) +
      renderSection(l10n.branchPanelTags, "tags", tags, model) ||
    `<div class="branchPanelEmpty">${escapeHtml(l10n.branchPanelNoMatchingBranches)}</div>`
  );
}
