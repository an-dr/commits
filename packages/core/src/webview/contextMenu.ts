import { addListenerToClass } from "./utils/dom";

/** The element the open menu belongs to, highlighted while it is open. */
let sourceElem: HTMLElement | null = null;

/**
 * Looked up per call rather than cached, so this module has no import-order
 * dependency on the panel markup and cannot hold a stale node.
 */
function getMenu(): HTMLElement {
  return document.getElementById("contextMenu")!;
}

/** Opens the menu at the pointer, flipping it when it would leave the viewport. */
export function showContextMenu(e: MouseEvent, items: ContextMenuElement[], source: HTMLElement) {
  // Suppress the host's native context menu. Required in browser-based VS Code
  // (vscode.dev / Codespaces), where it would otherwise render on top of ours.
  e.preventDefault();

  const menu = getMenu();
  let html = "";
  for (let i = 0; i < items.length; i++) {
    html +=
      items[i] !== null
        ? '<li class="contextMenuItem" data-index="' + i + '">' + items[i]!.title + "</li>"
        : '<li class="contextMenuDivider"></li>';
  }

  hideContextMenuIfOpen();
  menu.style.opacity = "0";
  menu.className = "active";
  menu.innerHTML = html;
  const bounds = menu.getBoundingClientRect();
  menu.style.left =
    (e.pageX - window.pageXOffset + bounds.width < window.innerWidth
      ? e.pageX - 2
      : e.pageX - bounds.width + 2) + "px";
  menu.style.top =
    (e.pageY - window.pageYOffset + bounds.height < window.innerHeight
      ? e.pageY - 2
      : e.pageY - bounds.height + 2) + "px";
  menu.style.opacity = "1";

  addListenerToClass("contextMenuItem", "click", (ev) => {
    ev.stopPropagation();
    hideContextMenu();
    items[parseInt((<HTMLElement>ev.target).dataset.index!)]!.onClick();
  });

  sourceElem = source;
  sourceElem.classList.add("contextMenuActive");
}

export function hideContextMenu() {
  const menu = getMenu();
  menu.className = "";
  menu.innerHTML = "";
  menu.style.left = "0px";
  menu.style.top = "0px";
  if (sourceElem !== null) {
    sourceElem.classList.remove("contextMenuActive");
    sourceElem = null;
  }
}

export function isContextMenuOpen(): boolean {
  return getMenu().classList.contains("active");
}

/** Closes the menu only when one is open, so unrelated clicks cost nothing. */
export function hideContextMenuIfOpen() {
  if (isContextMenuOpen()) {
    hideContextMenu();
  }
}
