import { escapeHtml } from "./utils/html";
import { svgIcons } from "./utils/icons";

/**
 * Renders one leaf of the tree. The tree owns structure, sorting and folder
 * markup; the caller owns what a row says, so a commit's file list and the
 * working tree's change list can differ in content without differing in shape.
 *
 * Must return one complete `<li>` element: the tree places it directly inside
 * the folder's `<ul>` and adds no wrapper of its own.
 *
 * @param index Position of the item in the array the tree was built from.
 * @param name Final path segment, unescaped, so the caller decides how it is
 *   rendered.
 */
export type FileTreeLeafRenderer = (index: number, name: string) => string;

/**
 * Groups paths into nested folders, remembering each leaf's position in the
 * source array so the caller can look the original item back up when rendering.
 */
export function buildFileTree(paths: readonly string[]): GitFolder {
  const root: GitFolder = {
    type: "folder",
    name: "",
    folderPath: "",
    contents: {},
    open: true,
  };
  for (let i = 0; i < paths.length; i++) {
    let current = root;
    const segments = paths[i].split("/");
    for (let j = 0; j < segments.length; j++) {
      if (j < segments.length - 1) {
        if (typeof current.contents[segments[j]] === "undefined") {
          current.contents[segments[j]] = {
            type: "folder",
            name: segments[j],
            folderPath: segments.slice(0, j + 1).join("/"),
            contents: {},
            open: true,
          };
        }
        current = <GitFolder>current.contents[segments[j]];
      } else {
        current.contents[segments[j]] = { type: "file", name: segments[j], index: i };
      }
    }
  }
  return root;
}

/** Folders before files, then by name, so a tree never reorders between renders. */
function sortedKeys(folder: GitFolder): string[] {
  return Object.keys(folder.contents).sort((a, b) => {
    const left = folder.contents[a];
    const right = folder.contents[b];
    if (left.type === "folder" && right.type === "file") return -1;
    if (left.type === "file" && right.type === "folder") return 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

/**
 * Renders the folder structure, delegating every file row to `renderLeaf`.
 * The caller closes nothing: the returned markup is a balanced `ul`.
 */
export function renderFileTree(folder: GitFolder, renderLeaf: FileTreeLeafRenderer): string {
  let html =
    (folder.name !== ""
      ? `<span class="gitFolder" data-folderpath="${encodeURIComponent(folder.folderPath)}">` +
        `<span class="gitFolderIcon">${folder.open ? svgIcons.openFolder : svgIcons.closedFolder}</span>` +
        `<span class="gitFolderName">${escapeHtml(folder.name)}</span></span>`
      : "") +
    `<ul class="gitFolderContents${folder.open ? "" : " hidden"}">`;
  for (const key of sortedKeys(folder)) {
    const entry = folder.contents[key];
    if (entry.type === "folder") {
      html += `<li${entry.open ? "" : ' class="closed"'}>${renderFileTree(entry, renderLeaf)}</li>`;
    } else {
      html += renderLeaf(entry.index, entry.name);
    }
  }
  return html + "</ul>";
}
