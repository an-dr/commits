import type { GitResult } from "@commits/ipc/native";
import type { HostPort } from "../host/host-port";
import { verdictOf, type HealthFacts, type Verdict } from "./verdict";

export interface RepositoryState {
  exists: boolean;
  isRepo: boolean;
  operation: HealthFacts["operation"];
}
export interface RepositoryHealth {
  repository: string;
  facts: HealthFacts;
  verdict: Verdict;
  branch: string | null;
  head: string | null;
}

/** Porcelain v2 reports each changed path once, including staged plus unstaged paths. */
export function parseStatus(status: string): Pick<HealthFacts, "ahead" | "behind" | "changes" | "conflicted" | "detached" | "hasUpstream"> & { branch: string | null } {
  const result = { ahead: 0, behind: 0, changes: 0, conflicted: 0, detached: false, hasUpstream: false, branch: null as string | null };
  for (const line of status.split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) { const branch = line.slice(14); result.detached = branch === "(detached)"; result.branch = result.detached ? null : branch; }
    else if (line.startsWith("# branch.upstream ")) result.hasUpstream = true;
    else if (line.startsWith("# branch.ab ")) { const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line); if (counts) { result.ahead = Number(counts[1]); result.behind = Number(counts[2]); } }
    else if (/^[12u?] /.test(line)) { result.changes++; if (line.startsWith("u ")) result.conflicted++; }
  }
  return result;
}

/** Correlates the three reads and discards responses for repositories left behind. */
export class HealthReader {
  private nextId = 900_000;
  private generation = 0;
  private pending = new Map<number, (result: GitResult) => void>();
  constructor(private readonly host: Pick<HostPort, "runGit" | "repositoryState">, private readonly deliver: (health: RepositoryHealth) => void) {}
  refresh(repository: string): void {
    const generation = ++this.generation;
    const state = this.host.repositoryState?.(repository) ?? { exists: true, isRepo: true, operation: null };
    const results: Record<string, GitResult> = {};
    const commands = { status: ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], head: ["rev-parse", "--verify", "HEAD"], remote: ["remote"] };
    for (const [key, args] of Object.entries(commands)) {
      const requestId = this.nextId++;
      this.pending.set(requestId, (result) => {
        if (generation !== this.generation) return;
        results[key] = result;
        if (Object.keys(results).length !== 3) return;
        const decoded = parseStatus(new TextDecoder().decode(results.status.stdout));
        const facts: HealthFacts = { ...decoded, ...state, isRepo: state.isRepo && results.status.exitCode === 0,
          hasCommits: results.head.exitCode === 0, hasRemote: results.remote.exitCode === 0 && results.remote.stdout.length > 0 };
        this.deliver({ repository, facts, verdict: verdictOf(facts), branch: decoded.branch,
          head: facts.hasCommits ? new TextDecoder().decode(results.head.stdout).trim() : null });
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
