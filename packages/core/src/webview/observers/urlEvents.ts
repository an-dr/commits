import { sendMessage } from "@an-dr/commits-core/webview/utils/host";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Routes supported links through the extension host instead of navigating the webview. */
export function observeExternalUrls(root: HTMLElement = document.body) {
  const follow = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const link = event.target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || !EXTERNAL_PROTOCOLS.has(link.protocol)) {
      return;
    }
    event.preventDefault();
    sendMessage({ command: "openExternalUrl", url: link.href });
  };

  root.addEventListener("click", follow);
  return () => root.removeEventListener("click", follow);
}
