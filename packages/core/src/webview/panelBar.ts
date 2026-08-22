import { svgIcons } from "./utils/icons";

/**
 * The button bar every side panel wears along its top edge.
 *
 * Both sidebars build their bar through here so a button added for one appears
 * the same in the other. The close button keeps the right edge whatever else
 * arrives; other actions fill in to its left, in the order they are added.
 */
export class PanelBar {
  private readonly bar: HTMLElement;
  /** Null until a close button is added; every other button goes before it. */
  private closeBtn: HTMLElement | null = null;

  constructor(panel: HTMLElement) {
    this.bar = document.createElement("div");
    this.bar.className = "panelBar";
    // First child: the bar owns the panel's top edge, and the content the panel
    // adds afterwards is inset below it by the stylesheet.
    panel.insertBefore(this.bar, panel.firstChild);
  }

  /** Adds an icon button, to the left of the close button when there is one. */
  public addButton(icon: string, title: string, onClick: () => void): HTMLElement {
    const button = document.createElement("div");
    button.className = "iconBtn panelBarBtn";
    button.title = title;
    button.innerHTML = icon;
    button.addEventListener("click", onClick);
    // Before the close button rather than after it: close holds the right edge
    // so it stays where the user learned it, however the bar grows.
    this.bar.insertBefore(button, this.closeBtn);
    return button;
  }

  /** The close button: hides the panel it belongs to, and holds the right edge. */
  public addCloseButton(onClose: () => void): HTMLElement {
    this.closeBtn = this.addButton(svgIcons.close, l10n.panelClose, onClose);
    return this.closeBtn;
  }

  public getElem(): HTMLElement {
    return this.bar;
  }
}
