import type { ToolView } from "@an-dr/commits-core/types";

/**
 * Which of the configured tools the view offers, and for what.
 *
 * A tool is configured with two argument templates, and an empty one is how
 * the user says "not for this": a diff-only tool has no `openArgs`, and an
 * editor that cannot compare two files has no `diffArgs`. Keeping that reading
 * in one place is what stops the button and the file tree disagreeing about
 * which tools exist.
 */

/** Tools the Open in button offers, in configured order. */
export function repositoryTools(tools: readonly ToolView[] | undefined): readonly ToolView[] {
  return (tools ?? []).filter((tool) => tool.command !== "" && tool.openArgs.length > 0);
}

/**
 * The tool a double-clicked file opens in, or null when none can diff.
 *
 * The first one wins rather than the user naming a default separately: the
 * order in the settings file is already a preference, and a second way to say
 * the same thing could contradict the first.
 */
export function diffTool(tools: readonly ToolView[] | undefined): ToolView | null {
  return (tools ?? []).find((tool) => tool.command !== "" && tool.diffArgs.length > 0) ?? null;
}

/** One entry the Open in chevron offers. */
export type OpenInMenuEntry =
  | { kind: "tool"; tool: ToolView }
  | { kind: "separator" }
  | { kind: "configure" };

/**
 * What the chevron lists.
 *
 * The configured tools come first, then the way to change them: the menu is
 * always worth opening, even with a single tool, because "configure" is the
 * answer to "why is my editor not in here". The separator keeps the action
 * from reading as one more tool.
 */
export function openInMenuEntries(tools: readonly ToolView[] | undefined): OpenInMenuEntry[] {
  const entries: OpenInMenuEntry[] = repositoryTools(tools).map((tool) => ({ kind: "tool", tool }));
  if (entries.length > 0) {
    entries.push({ kind: "separator" });
  }
  entries.push({ kind: "configure" });
  return entries;
}
