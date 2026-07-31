import { escapeHtml } from "./utils/html";

export interface FullDiffData {
  diff: string | null;
  oldContent: string | null;
  newContent: string | null;
  oldExists: boolean;
  newExists: boolean;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export type DiffRowKind = "context" | "removed" | "added";

export interface DiffRow {
  kind: DiffRowKind;
  oldNum: string;
  newNum: string;
  content: string;
  changed: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NEWLINE = "\\ No newline at end of file";

/** Splits file text into display lines, tolerating either line ending. */
export function toDisplayLines(content: string | null): string[] {
  if (content === null) {
    return [];
  }
  const normalized = content.replace(/\r\n?/g, "\n");
  if (normalized === "") {
    return [];
  }
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Reads the hunk headers and bodies out of a unified diff. */
export function parseUnifiedDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  for (const line of diff.replace(/\r\n?/g, "\n").split("\n")) {
    const match = HUNK_HEADER.exec(line);
    if (match !== null) {
      // A zero line count means the hunk adds or removes nothing on that side,
      // and the header then names the line *before* the change rather than the
      // first line of it.
      current = {
        oldStart: parseInt(match[1]) + (match[2] === "0" ? 1 : 0),
        newStart: parseInt(match[3]) + (match[4] === "0" ? 1 : 0),
        lines: []
      };
      hunks.push(current);
      continue;
    }
    if (
      current !== null &&
      (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line === NO_NEWLINE)
    ) {
      current.lines.push(line);
    }
  }
  return hunks;
}

/**
 * Rebuilds the whole file as numbered rows, using the hunks only to decide
 * which lines changed. The diff alone carries a few lines of context, so the
 * full text of both endpoints is what makes the unchanged remainder visible.
 */
export function buildUnifiedRows(
  oldLines: readonly string[],
  newLines: readonly string[],
  hunks: readonly DiffHunk[]
): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNum = 1;
  let newNum = 1;

  const pushContext = () => {
    rows.push({
      kind: "context",
      oldNum: String(oldNum),
      newNum: String(newNum),
      content: newLines[newNum - 1] ?? oldLines[oldNum - 1] ?? "",
      changed: false
    });
    oldNum++;
    newNum++;
  };

  for (const hunk of hunks) {
    while (oldNum < hunk.oldStart && newNum < hunk.newStart) {
      pushContext();
    }
    for (const line of hunk.lines) {
      if (line === NO_NEWLINE) {
        continue;
      }
      if (line.startsWith(" ")) {
        pushContext();
      } else if (line.startsWith("-")) {
        rows.push({
          kind: "removed",
          oldNum: String(oldNum),
          newNum: "",
          content: oldLines[oldNum++ - 1] ?? line.slice(1),
          changed: true
        });
      } else {
        rows.push({
          kind: "added",
          oldNum: "",
          newNum: String(newNum),
          content: newLines[newNum++ - 1] ?? line.slice(1),
          changed: true
        });
      }
    }
  }
  while (oldNum <= oldLines.length && newNum <= newLines.length) {
    pushContext();
  }
  return rows;
}

/** One display line of a side, or null where the other side has no counterpart. */
export interface SideBySideCell {
  num: string;
  content: string;
}

export interface SideBySideRow {
  left: SideBySideCell | null;
  right: SideBySideCell | null;
  changed: boolean;
}

/** Stands in for a folded run of unchanged lines in compact mode. */
export interface SpacerRow {
  spacer: number;
}

/** Lines of unchanged context kept on each side of a change in compact mode. */
const COMPACT_CONTEXT = 2;

function isSpacer(row: { changed: boolean } | SpacerRow): row is SpacerRow {
  return "spacer" in row;
}

/**
 * Folds runs of unchanged rows longer than twice the kept context into a single
 * spacer, so a small change in a large file does not bury itself in context.
 */
export function compactRows<T extends { changed: boolean }>(
  rows: readonly T[],
  enabled: boolean
): (T | SpacerRow)[] {
  if (!enabled) {
    return [...rows];
  }
  const output: (T | SpacerRow)[] = [];
  let runStart = -1;
  const flush = (endExclusive: number) => {
    if (runStart < 0) {
      return;
    }
    const count = endExclusive - runStart;
    if (count <= COMPACT_CONTEXT * 2) {
      output.push(...rows.slice(runStart, endExclusive));
    } else {
      output.push(...rows.slice(runStart, runStart + COMPACT_CONTEXT));
      output.push({ spacer: count - COMPACT_CONTEXT * 2 });
      output.push(...rows.slice(endExclusive - COMPACT_CONTEXT, endExclusive));
    }
    runStart = -1;
  };

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].changed) {
      flush(i);
      output.push(rows[i]);
    } else if (runStart < 0) {
      runStart = i;
    }
  }
  flush(rows.length);
  return output;
}

/**
 * Pairs the unified rows into two columns, zipping each run of removals against
 * the run of additions that follows it so both sides stay aligned.
 */
export function pairSideBySideRows(rows: readonly DiffRow[]): SideBySideRow[] {
  const paired: SideBySideRow[] = [];
  for (let i = 0; i < rows.length;) {
    if (!rows[i].changed) {
      paired.push({
        left: { num: rows[i].oldNum, content: rows[i].content },
        right: { num: rows[i].newNum, content: rows[i].content },
        changed: false
      });
      i++;
      continue;
    }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (i < rows.length && rows[i].changed) {
      (rows[i].kind === "removed" ? removed : added).push(rows[i]);
      i++;
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++) {
      paired.push({
        left: j < removed.length ? { num: removed[j].oldNum, content: removed[j].content } : null,
        right: j < added.length ? { num: added[j].newNum, content: added[j].content } : null,
        changed: true
      });
    }
  }
  return paired;
}

/** Marks the first row of each changed run so navigation steps by block. */
function navClass(rows: readonly unknown[], index: number, changed: boolean): string {
  const previous = rows[index - 1] as { changed?: boolean } | undefined;
  return changed && previous?.changed !== true ? " diffChangedBlock" : "";
}

function spacerHtml(count: number, columns: number): string {
  const label = escapeHtml(l10n.fullDiffFoldedLines.replace("{0}", String(count)));
  return (
    `<div class="diffRow diffSpacer">` +
    `<span class="diffLnOld"></span>${columns === 2 ? '<span class="diffLnNew"></span>' : ""}` +
    `<span class="diffLnSep"></span><span class="diffRowContent">${label}</span></div>`
  );
}

/** Renders the unified rows as the panel's line grid. */
export function renderUnifiedView(rows: readonly (DiffRow | SpacerRow)[]): string {
  let html = '<div class="diffFullView">';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isSpacer(row)) {
      html += spacerHtml(row.spacer, 2);
      continue;
    }
    const classes = row.changed
      ? `diffRow diffChanged diff${row.kind === "added" ? "Added" : "Removed"}${navClass(rows, i, true)}`
      : "diffRow diffContext";
    html +=
      `<div class="${classes}"><span class="diffLnOld">${row.oldNum}</span>` +
      `<span class="diffLnNew">${row.newNum}</span><span class="diffLnSep">│</span>` +
      `<span class="diffRowContent">${escapeHtml(row.content)}</span></div>`;
  }
  return html + "</div>";
}

/** One cell of a side-by-side row, or a placeholder where the side is empty. */
function sideHtml(
  cell: SideBySideCell | null,
  changed: boolean,
  changedClass: string,
  nav: string
): string {
  if (cell === null) {
    return `<div class="diffSbsRow diffSbsPlaceholder"></div>`;
  }
  const classes = changed ? `diffChanged ${changedClass}${nav}` : "diffContext";
  return (
    `<div class="diffSbsRow ${classes}"><span class="diffLnOld">${cell.num}</span>` +
    `<span class="diffRowContent">${escapeHtml(cell.content)}</span></div>`
  );
}

/** Renders the paired rows as two columns that scroll together. */
export function renderSideBySideView(rows: readonly (SideBySideRow | SpacerRow)[]): string {
  let left = "";
  let right = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isSpacer(row)) {
      const html = `<div class="diffSbsRow diffSpacer">${escapeHtml(l10n.fullDiffFoldedLines.replace("{0}", String(row.spacer)))}</div>`;
      left += html;
      right += html;
      continue;
    }
    const nav = navClass(rows, i, row.changed);
    left += sideHtml(row.left, row.changed, "diffRemoved", nav);
    right += sideHtml(row.right, row.changed, "diffAdded", "");
  }
  return (
    `<div class="diffSbsContainer"><div class="diffSbsPane diffSbsPaneOld">${left}</div>` +
    `<div class="diffSbsPane diffSbsPaneNew">${right}</div></div>`
  );
}

/** Renders Git's own diff output, classified line by line. */
export function renderRawView(diff: string): string {
  const lines = toDisplayLines(diff);
  let html = '<div class="diffRawView">';
  for (const line of lines) {
    const classes = ["diffRow", "diffRawLine"];
    if (line.startsWith("@@")) {
      classes.push("diffHunkHeader", "diffChangedBlock");
    } else if (RAW_FILE_HEADER.some((prefix) => line.startsWith(prefix))) {
      classes.push("diffFileHeader");
    } else if (line.startsWith("+")) {
      classes.push("diffAdded");
    } else if (line.startsWith("-")) {
      classes.push("diffRemoved");
    }
    html += `<div class="${classes.join(" ")}"><span class="diffRowContent">${escapeHtml(line)}</span></div>`;
  }
  return html + "</div>";
}

const RAW_FILE_HEADER = [
  "+++",
  "---",
  "diff --git",
  "index ",
  "new file mode ",
  "deleted file mode ",
  "similarity index ",
  "rename from ",
  "rename to "
];

export type FullDiffViewMode = "unified" | "sideBySide" | "raw";

export interface FullDiffRenderOptions {
  mode: FullDiffViewMode;
  compact: boolean;
}

/** Builds the panel body for one file, or a message when there is nothing to show. */
export function renderFullDiff(data: FullDiffData | null, options: FullDiffRenderOptions): string {
  if (data === null || data.diff === null) {
    return `<div class="fullDiffMessage">${escapeHtml(l10n.fullDiffUnableToLoad)}</div>`;
  }
  if (options.mode === "raw") {
    return data.diff === ""
      ? `<div class="fullDiffMessage">${escapeHtml(l10n.fullDiffNoChanges)}</div>`
      : renderRawView(data.diff);
  }
  const rows = buildUnifiedRows(
    toDisplayLines(data.oldExists ? data.oldContent : null),
    toDisplayLines(data.newExists ? data.newContent : null),
    parseUnifiedDiffHunks(data.diff)
  );
  if (rows.length === 0) {
    return `<div class="fullDiffMessage">${escapeHtml(l10n.fullDiffNoChanges)}</div>`;
  }
  return options.mode === "sideBySide"
    ? renderSideBySideView(compactRows(pairSideBySideRows(rows), options.compact))
    : renderUnifiedView(compactRows(rows, options.compact));
}
