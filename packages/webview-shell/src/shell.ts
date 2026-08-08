export function buildGraphShell(t: (message: string) => string): string {
  const text = (message: string) => escapeHtml(t(message));
  return `
    <div id="view" tabindex="-1">
      <div id="topBar">
        <div id="controls">
          <div id="controlsLeft">
            <div id="repoSelect" class="dropdown"></div>
            <div id="sidebarToggleBtn" class="iconBtn" title="${text("Toggle Branch Panel")}"></div>
            <div class="controlsSpacer"></div>
            <span id="commitFilterControl"><input id="commitFilter" type="search" spellcheck="false" placeholder="${text("Filter commits...")}" title="${text("Filter by message, author, email, or hash")}"></span>
            <div id="findBtn" class="iconBtn" title="${text("Find Commits")}"></div>
            <div class="controlsSpacer"></div>
          </div>
          <div id="controlsBtns">
            <div id="refreshBtn" class="iconBtn" title="${text("Refresh")}"></div>
            <div id="resetBtn" class="iconBtn" title="${text("Reset to HEAD")}"></div>
            <div id="pullBtn" class="iconBtn"></div>
            <div id="pushBtn" class="iconBtn" title="${text("Push Current Branch")}"></div>
            <div id="appMenuSlot"></div>
            <div id="moreBtn" class="iconBtn" title="${text("More Actions")}"></div>
          </div>
        </div>
      </div>
      <div id="findWidget" aria-hidden="true">
        <input id="findInput" type="search" spellcheck="false" placeholder="${text("Find commits...")}">
        <span id="findMatchCount" aria-live="polite"></span>
        <button id="findPreviousBtn" title="${text("Previous Match")}" aria-label="${text("Previous Match")}">↑</button>
        <button id="findNextBtn" title="${text("Next Match")}" aria-label="${text("Next Match")}">↓</button>
        <button id="findCloseBtn" title="${text("Close")}" aria-label="${text("Close")}">×</button>
      </div>
      <aside id="branchPanelSidebar"><div id="branchPanel"></div><div id="branchPanelResizeHandle"></div></aside>
      <div id="repoInProgressBanner"></div>
      <div id="graphScroll">
        <div id="content"><div id="commitGraph"></div><div id="commitTable"></div></div>
        <div id="footer"></div>
      </div>
    </div>
    <div id="filesPanel"></div>
    <div id="fullDiffPanel">
      <div id="fullDiffResizeHandle"></div>
      <div id="fullDiffHeader">
        <span id="fullDiffFilename"></span>
        <span id="fullDiffControls">
          <button id="fullDiffMode-unified" title="${text("Unified full file view")}">${text("Unified")}</button>
          <button id="fullDiffMode-sideBySide" title="${text("Side by side full file view")}">${text("Split")}</button>
          <button id="fullDiffMode-raw" title="${text("Raw git diff output")}">${text("Raw")}</button>
          <button id="fullDiffCompactBtn" title="${text("Fold long runs of unchanged lines")}">${text("Compact")}</button>
          <button id="fullDiffPrevChangeBtn" title="${text("Previous Change")}" aria-label="${text("Previous Change")}">▲</button>
          <span id="fullDiffChangeCounter" aria-live="polite"></span>
          <button id="fullDiffNextChangeBtn" title="${text("Next Change")}" aria-label="${text("Next Change")}">▼</button>
        </span>
        <button id="fullDiffCloseBtn" title="${text("Close")}" aria-label="${text("Close")}">×</button>
      </div>
      <div id="fullDiffContent"></div>
    </div>
    <ul id="contextMenu"></ul><div id="dialogBacking"></div><div id="dialog"></div><div id="scrollShadow"></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
