import type {
  GitCommitNode,
  GitRef,
  QueryResponse,
} from "../../../packages/core/src/backend/types";
import type { GitResult, GitRun } from "../../../ipc/ts/native";

interface GitHost {
  runGit(request: GitRun): void;
}

interface LoadCommitsRequest {
  readonly command: "loadCommits";
  readonly repo: string;
  readonly branchName: string;
  readonly maxCommits: number;
  readonly showRemoteBranches: boolean;
  readonly hard: boolean;
}

interface LoadBranchesRequest {
  readonly command: "loadBranches";
  readonly repo: string;
  readonly showRemoteBranches: boolean;
  readonly hard: boolean;
}

type BatchResult = Record<string, GitResult>;

/**
 * Adapts the MIT view's read queries to the correlated native Bones Git
 * service. It deliberately does not import simple-git or any Node API.
 */
export class MitGraphBackend {
  private nextRequestId = 30_000;
  private readonly pending = new Map<number, (result: GitResult) => void>();

  constructor(private readonly host: GitHost) {}

  receive(result: GitResult): void {
    const callback = this.pending.get(result.requestId);
    if (callback === undefined) return;
    this.pending.delete(result.requestId);
    callback(result);
  }

  loadCommits(request: LoadCommitsRequest, deliver: (response: QueryResponse) => void): void {
    const maxCommits = clamp(request.maxCommits, 1, 2_000);
    const separator = "%x1f";
    const logArgs = [
      "log",
      `--max-count=${maxCommits + 1}`,
      `--format=%H${separator}%P${separator}%an${separator}%ae${separator}%at${separator}%s`,
      "--date-order",
    ];
    if (request.branchName) {
      logArgs.push(request.branchName);
    } else {
      logArgs.push("--branches", "--tags");
      if (request.showRemoteBranches) logArgs.push("--remotes");
    }

    const refArgs = ["show-ref"];
    if (!request.showRemoteBranches) refArgs.push("--heads", "--tags");
    refArgs.push("-d", "--head");

    this.batch(
      request.repo,
      {
        log: logArgs,
        refs: refArgs,
        status: ["status", "--porcelain=v1", "--untracked-files=normal"],
      },
      (results) => {
        const refs = parseRefs(successText(results.refs));
        let commits = parseCommits(successText(results.log));
        const moreCommitsAvailable = commits.length > maxCommits;
        if (moreCommitsAvailable) commits = commits.slice(0, maxCommits);
        attachRefs(commits, refs.refs);

        const changed = nonEmptyLines(successText(results.status)).length;
        if (changed > 0 && refs.head !== null) {
          commits.unshift({
            hash: "*",
            parentHashes: [refs.head],
            author: "*",
            email: "",
            date: Math.round(Date.now() / 1_000),
            message: `Uncommitted Changes (${changed})`,
            refs: [],
          });
        }

        deliver({
          command: "loadCommits",
          commits,
          head: refs.head,
          moreCommitsAvailable,
          hard: request.hard,
        });
      },
    );
  }

  loadBranches(request: LoadBranchesRequest, deliver: (response: QueryResponse) => void): void {
    const refRoots = ["refs/heads"];
    if (request.showRemoteBranches) refRoots.push("refs/remotes");
    this.batch(
      request.repo,
      {
        branches: ["for-each-ref", "--format=%(refname)", ...refRoots],
        head: ["symbolic-ref", "--quiet", "--short", "HEAD"],
      },
      (results) => {
        const branchesResult = results.branches;
        const branches = nonEmptyLines(successText(branchesResult))
          .filter((ref) => !ref.endsWith("/HEAD"))
          .map((ref) =>
            ref.startsWith("refs/heads/")
              ? ref.slice("refs/heads/".length)
              : ref.startsWith("refs/remotes/")
                ? `remotes/${ref.slice("refs/remotes/".length)}`
                : ref,
          );
        const head = successText(results.head).trim() || null;
        deliver({
          command: "loadBranches",
          branches: head === null ? branches : [head, ...branches.filter((branch) => branch !== head)],
          head,
          hard: request.hard,
          isRepo: branchesResult.status === "completed" && branchesResult.exitCode === 0,
        });
      },
    );
  }

  private batch(
    cwd: string,
    operations: Record<string, string[]>,
    complete: (results: BatchResult) => void,
  ): void {
    const entries = Object.entries(operations);
    const results: BatchResult = {};
    let remaining = entries.length;
    for (const [name, args] of entries) {
      this.run(cwd, args, (result) => {
        results[name] = result;
        remaining -= 1;
        if (remaining === 0) complete(results);
      });
    }
  }

  private run(cwd: string, args: string[], callback: (result: GitResult) => void): void {
    const requestId = this.nextRequestId++;
    this.pending.set(requestId, callback);
    this.host.runGit({ requestId, cwd, args, timeoutMs: 15_000 });
  }
}

function parseCommits(output: string): GitCommitNode[] {
  const commits: GitCommitNode[] = [];
  for (const line of nonEmptyLines(output)) {
    const fields = line.split("\u001f");
    if (fields.length !== 6) continue;
    commits.push({
      hash: fields[0],
      parentHashes: fields[1] ? fields[1].split(" ") : [],
      author: fields[2],
      email: fields[3],
      date: Number.parseInt(fields[4], 10),
      message: fields[5],
      refs: [],
    });
  }
  return commits;
}

function parseRefs(output: string): { head: string | null; refs: GitRef[] } {
  let head: string | null = null;
  const refs: GitRef[] = [];
  const seen = new Set<string>();
  for (const line of nonEmptyLines(output)) {
    const space = line.indexOf(" ");
    if (space < 1) continue;
    const hash = line.slice(0, space);
    const ref = line.slice(space + 1);
    if (ref === "HEAD") {
      head = hash;
      continue;
    }
    let item: GitRef | null = null;
    if (ref.startsWith("refs/heads/")) {
      item = { hash, name: ref.slice(11), type: "head" };
    } else if (ref.startsWith("refs/remotes/")) {
      item = { hash, name: ref.slice(13), type: "remote" };
    } else if (ref.startsWith("refs/tags/")) {
      const peeled = ref.endsWith("^{}");
      item = { hash, name: ref.slice(10, peeled ? -3 : undefined), type: "tag" };
    }
    if (item !== null) {
      const key = `${item.type}:${item.name}`;
      if (!seen.has(key) || ref.endsWith("^{}")) {
        const old = refs.findIndex((candidate) => `${candidate.type}:${candidate.name}` === key);
        if (old >= 0) refs.splice(old, 1);
        refs.push(item);
        seen.add(key);
      }
    }
  }
  return { head, refs };
}

function attachRefs(commits: GitCommitNode[], refs: GitRef[]): void {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  for (const ref of refs) byHash.get(ref.hash)?.refs.push(ref);
}

function successText(result: GitResult): string {
  return result.status === "completed" && result.exitCode === 0
    ? new TextDecoder().decode(result.stdout)
    : "";
}

function nonEmptyLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : min;
}
