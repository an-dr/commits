import type { BranchPanelRenderModel, BranchPanelRenderOption } from "./branchPanel";
import { escapeHtml } from "./utils/html";
import { svgIcons } from "./utils/icons";

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

function renderItem(option: BranchPanelRenderOption, name: string, indent: number): string {
  const classes = ["branchPanelItem"];
  if (option.selected) {
    classes.push("selected");
  }
  if (option.current) {
    classes.push("currentBranch");
  }
  return `<div class="${classes.join(" ")}" data-value="${escapeHtml(option.value)}" title="${escapeHtml(option.name)}" style="padding-left:${4 + indent * 14}px">
    <span class="branchPanelCheck">${option.selected ? "✓" : ""}</span>
    <span class="branchPanelItemName">${escapeHtml(name)}</span>
    ${option.current ? '<span class="branchPanelCurrentBadge">HEAD</span>' : ""}
  </div>`;
}

function renderTree(
  nodes: readonly BranchTreeNode[],
  indent: number,
  collapsed: ReadonlySet<string>
): string {
  let html = "";
  for (const node of nodes) {
    if (node.type === "leaf") {
      html += renderItem(node.option, node.displayName, indent);
      continue;
    }
    const isCollapsed = collapsed.has(node.path);
    html += `<div class="branchPanelFolder" data-folder="${escapeHtml(node.path)}" style="padding-left:${4 + indent * 14}px">
      <span class="branchPanelFolderIcon">${isCollapsed ? svgIcons.closedFolder : svgIcons.openFolder}</span>
      <span class="branchPanelFolderName">${escapeHtml(node.name)}/</span>
    </div>`;
    if (!isCollapsed) {
      html += renderTree(node.children, indent + 1, collapsed);
    }
  }
  return html;
}

function renderSection(
  label: string,
  sectionKey: string,
  options: readonly BranchPanelRenderOption[],
  model: BranchPanelRenderModel
): string {
  if (options.length === 0) {
    return "";
  }
  let tree = sortTree(buildTree(options, sectionKey), model.groupsFirst);
  if (model.flattenSingleChildGroups) {
    tree = flattenSingleChildFolders(tree);
  }
  return `<div class="branchPanelSectionHeader">${escapeHtml(label)} (${options.length})</div>${renderTree(
    tree,
    1,
    model.collapsedFolders
  )}`;
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
    (option) => option.value !== "" && !option.value.startsWith("remotes/") && matches(option)
  );
  const remotes = model.options
    .filter((option) => option.value.startsWith("remotes/") && matches(option))
    .map((option) => ({
      name: option.value.slice("remotes/".length),
      value: option.value,
      selected: option.selected,
      current: option.current
    }));

  return (
    (showAll ? renderItem(showAll, showAll.name, 0) : "") +
      renderSection(l10n.branchPanelLocal, "local", locals, model) +
      renderSection(l10n.branchPanelRemote, "remote", remotes, model) ||
    `<div class="branchPanelEmpty">${escapeHtml(l10n.branchPanelNoMatchingBranches)}</div>`
  );
}
