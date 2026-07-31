/**
 * Type definitions for localized strings in webview.
 * This file is generated based on webviewL10n.ts
 */

import type { LocalizedStrings } from "@an-dr/commits-core/webview/l10nContract";

declare global {
  /**
   * Localized strings provided by the extension context.
   * Available in the webview via a global variable injected in the HTML.
   */
  var l10n: LocalizedStrings;
}
