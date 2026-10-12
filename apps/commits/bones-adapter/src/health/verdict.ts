export interface HealthFacts {
  exists: boolean;
  isRepo: boolean;
  conflicted: number;
  operation: "merge" | "rebase" | "cherry-pick" | "revert" | "bisect" | null;
  ahead: number;
  behind: number;
  changes: number;
  detached: boolean;
  hasCommits: boolean;
  hasUpstream: boolean;
  hasRemote: boolean;
}
export const VERDICTS = [
  { id: "missing", label: "Missing", urgency: "warning" },
  { id: "not-a-repo", label: "Not a repository", urgency: "warning" },
  { id: "conflicted", label: "Conflicts", urgency: "warning" },
  { id: "in-progress", label: "In progress", urgency: "caution" },
  { id: "diverged", label: "Diverged", urgency: "caution" },
  { id: "behind", label: "Behind", urgency: "advisory" },
  { id: "dirty", label: "Uncommitted", urgency: "caution" },
  { id: "ahead", label: "Unpushed", urgency: "advisory" },
  { id: "detached", label: "Detached HEAD", urgency: "caution" },
  { id: "unpublished", label: "Unpublished", urgency: "advisory" },
  { id: "clean", label: "Clean", urgency: "normal" },
] as const;
export type Verdict = typeof VERDICTS[number];

/** First-match precedence is the published repository-health contract. */
export function verdictOf(facts: HealthFacts): Verdict {
  const rules = [!facts.exists, !facts.isRepo, facts.conflicted > 0, facts.operation !== null,
    facts.ahead > 0 && facts.behind > 0, facts.behind > 0, facts.changes > 0, facts.ahead > 0,
    facts.detached && facts.hasCommits, !facts.hasUpstream && facts.hasRemote && facts.hasCommits, true];
  return VERDICTS[rules.findIndex(Boolean)];
}
