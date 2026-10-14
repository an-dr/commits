import type { GitResult } from "@commits/ipc/native";
import type { HostPort } from "../host/host-port";
import { verdictOf, type HealthFacts, type Verdict } from "./verdict";
import { RequestIds } from "../request-ids";
import type { WorkingTreeStatus } from "@an-dr/commits-core/backend/queries/repoInProgress";

export interface RepositoryHealth {
  repository: string;
  facts: HealthFacts;
  verdict: Verdict;
  branch: string | null;
  head: string | null;
  /** The same counts the shared core's in-progress banner shows. */
  workingTree: WorkingTreeStatus;
}

type StatusFacts = Pick<HealthFacts, "ahead" | "behind" | "changes" | "conflicted" | "detached" | "hasUpstream">;

/**
 * Reads `git status --porcelain=v2 --branch`. Porcelain v2 reports each path
 * once, so `changes` counts paths; `workingTree` splits them the way the
 * shared core's banner does, where a path both staged and modified counts in
 * both `staged` and `changed`.
 */
export function parseStatus(status: string): StatusFacts & { branch: string | null; workingTree: WorkingTreeStatus } {
  const result = { ahead: 0, behind: 0, changes: 0, conflicted: 0, detached: false, hasUpstream: false, branch: null as string | null };
  const workingTree = { changed: 0, staged: 0, conflicts: 0, untracked: 0 };
  for (const line of status.split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) {
      const branch = line.slice("# branch.head ".length);
      result.detached = branch === "(detached)";
      result.branch = result.detached ? null : branch;
    } else if (line.startsWith("# branch.upstream ")) {
      result.hasUpstream = true;
    } else if (line.startsWith("# branch.ab ")) {
      const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (counts) {
        result.ahead = Number(counts[1]);
        result.behind = Number(counts[2]);
      }
    } else if (line.startsWith("u ")) {
      result.changes++;
      result.conflicted++;
      workingTree.conflicts++;
    } else if (line.startsWith("? ")) {
      result.changes++;
      workingTree.untracked++;
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Ordinary and renamed entries: XY, where "." means unchanged.
      result.changes++;
      if (line[2] !== ".") workingTree.staged++;
      if (line[3] !== ".") workingTree.changed++;
    }
  }
  return { ...result, workingTree };
}

/** Correlates the three reads and discards responses for repositories left behind. */
export class HealthReader {
  private readonly requestIds = new RequestIds("health");
  private generation = 0;
  private pending = new Map<number, (result: GitResult) => void>();
  constructor(private readonly host: Pick<HostPort, "runGit" | "repositoryState">, private readonly deliver: (health: RepositoryHealth) => void) {}
  refresh(repository: string): void {
    const generation = ++this.generation;
    const state = this.host.repositoryState(repository);
    const results: Record<string, GitResult> = {};
    const commands = { status: ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], head: ["rev-parse", "--verify", "HEAD"], remote: ["remote"] };
    for (const [key, args] of Object.entries(commands)) {
      const requestId = this.requestIds.next();
      this.pending.set(requestId, (result) => {
        if (generation !== this.generation) return;
        results[key] = result;
        if (Object.keys(results).length !== 3) return;
        const decoded = parseStatus(new TextDecoder().decode(results.status.stdout));
        const { workingTree: _workingTree, branch: _branch, ...counted } = decoded;
        const facts: HealthFacts = { ...counted, ...state, isRepo: state.isRepo && results.status.exitCode === 0,
          hasCommits: results.head.exitCode === 0, hasRemote: results.remote.exitCode === 0 && results.remote.stdout.length > 0 };
        this.deliver({ repository, facts, verdict: verdictOf(facts), branch: decoded.branch,
          head: facts.hasCommits ? new TextDecoder().decode(results.head.stdout).trim() : null,
          workingTree: decoded.workingTree });
      });
      this.host.runGit({ requestId, cwd: repository, args, env: { GIT_OPTIONAL_LOCKS: "0" } });
    }
  }
  receive(result: GitResult): boolean {
    const deliver = this.pending.get(result.requestId);
    if (!deliver) return false;
    this.pending.delete(result.requestId);
    deliver(result);
    return true;
  }
}
