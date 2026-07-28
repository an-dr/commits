import type { GitResult, GitRun } from "../../../proto/ts/native";
import { parseLog, parseRefSnapshot } from "./parsers";
import { RepositoryGraphCache } from "./repository-graph-cache";
import type { Commit, RefSnapshot } from "./models";

export interface RepositorySnapshot {
  readonly repository: string;
  readonly commits: readonly Commit[];
  readonly refs: RefSnapshot;
  readonly errors: readonly string[];
}

export interface ReadBackendHost {
  runGit(request: GitRun): void;
  deliver(snapshot: RepositorySnapshot): void;
}

interface Load {
  readonly repository: string;
  readonly generation: number;
  pending: number;
  commits: readonly Commit[];
  refs: RefSnapshot;
  head: string | null;
  errors: string[];
}

type Operation = "log" | "refs" | "head";

/** Coordinates bounded, correlated Git reads without blocking the WASM frame. */
export class ReadBackend {
  private nextRequestId = 10_000;
  private readonly requests = new Map<number, { load: Load; operation: Operation }>();
  private readonly cache = new RepositoryGraphCache<Commit, RepositorySnapshot>();

  constructor(private readonly host: ReadBackendHost) {}

  load(repository: string, commitLimit: number, includeRemotes: boolean): void {
    const normalized = repository.replace(/\\/g, "/").replace(/\/+$/, "");
    // Invalidate late results from a preceding refresh of the same repository.
    this.cache.advanceGeneration(normalized);
    const load: Load = {
      repository: normalized,
      generation: this.cache.generation(normalized),
      pending: 3,
      commits: [],
      refs: { head: null, branches: [], tags: [], remotes: [] },
      head: null,
      errors: [],
    };
    this.request(load, "log", [
      "log", `--max-count=${commitLimit}`,
      "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s",
    ]);
    this.request(load, "refs", [
      "for-each-ref", "--format=%(objectname)%x1f%(refname)%x1f%(*objectname)",
      "refs/heads", "refs/tags", ...(includeRemotes ? ["refs/remotes"] : []),
    ]);
    this.request(load, "head", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  }

  receive(result: GitResult): void {
    const pending = this.requests.get(result.requestId);
    if (pending === undefined) return;
    this.requests.delete(result.requestId);
    const { load, operation } = pending;
    if (result.status !== "completed" || (result.exitCode !== 0 && operation !== "head")) {
      load.errors.push(`${operation}: ${errorText(result)}`);
    } else {
      try {
        const output = new TextDecoder().decode(result.stdout);
        if (operation === "log") load.commits = parseLog(output);
        if (operation === "refs") load.refs = parseRefSnapshot(output, load.head);
        if (operation === "head") load.head = output.trim() || null;
      } catch (error) {
        load.errors.push(`${operation}: ${String(error)}`);
      }
    }
    load.pending -= 1;
    if (load.pending === 0) this.complete(load);
  }

  private request(load: Load, operation: Operation, args: string[]): void {
    const requestId = this.nextRequestId++;
    this.requests.set(requestId, { load, operation });
    this.host.runGit({ requestId, cwd: load.repository, args, timeoutMs: 15_000 });
  }

  private complete(load: Load): void {
    const refs = { ...load.refs, head: load.head };
    const snapshot: RepositorySnapshot = {
      repository: load.repository,
      commits: load.commits,
      refs,
      errors: load.errors,
    };
    if (this.cache.setForGeneration(load.repository, "main", load.generation, load.commits, snapshot)) {
      this.host.deliver(snapshot);
    }
  }
}

function errorText(result: GitResult): string {
  const text = new TextDecoder().decode(result.stderr).trim();
  return text.slice(0, 500) || result.status;
}
