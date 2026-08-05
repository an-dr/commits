import type {
  GitCommitDetails,
  GitCommitNode,
  GitFileChange,
  GitFileChangeType,
  GitRef,
  QueryResponse,
} from "@an-dr/commits-core/backend/types";
import type { GitResult, GitRun } from "@commits/ipc/native";

interface GitHost {
  runGit(request: GitRun): void;
}

interface LoadCommitsRequest {
  readonly command: "loadCommits";
  readonly repo: string;
  readonly branchName: string;
  /** Every selected branch; empty or containing "" means every ref. */
  readonly branches?: readonly string[];
  readonly maxCommits: number;
  readonly showRemoteBranches: boolean;
  readonly hard: boolean;
}

interface CommitDetailsRequest {
  readonly command: "commitDetails";
  readonly repo: string;
  readonly commitHash: string;
}

interface LoadBranchesRequest {
  readonly command: "loadBranches";
  readonly repo: string;
  readonly showRemoteBranches: boolean;
  readonly hard: boolean;
}

interface CommitComparisonRequest {
  readonly command: "commitComparison";
  readonly repo: string;
  readonly fromHash: string;
  readonly toHash: string;
}

interface FullDiffContentRequest {
  readonly command: "fullDiffContent";
  readonly repo: string;
  readonly fromHash: string;
  readonly toHash: string;
  readonly oldFilePath: string;
  readonly newFilePath: string;
  readonly type: GitFileChangeType;
}

type BatchResult = Record<string, GitResult>;

/** Revisions the view sends are commit hashes; anything else is not diffable. */
const REVISION = /^[0-9a-f]{4,64}$/i;

/**
 * Git's empty tree. Diffing a parentless commit against it shows every file as
 * added, where its missing parent would simply fail to resolve.
 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Shown when a selected pair holds something that is not a commit, which today
 * means the synthetic uncommitted-changes row.
 */
const UNCOMPARABLE_REVISIONS = "These two rows cannot be compared in the standalone host yet.";

/** Panel input for a file that cannot be read; the panel reports it as unloadable. */
const UNREADABLE_FULL_DIFF = {
  command: "fullDiffContent",
  diff: null,
  oldContent: null,
  newContent: null,
  oldExists: false,
  newExists: false,
} as const;

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
    const selected = (request.branches ?? (request.branchName ? [request.branchName] : []))
      .filter((branch) => branch !== "");
    if (selected.length > 0) {
      // Ranges are rejected so a branch name can never extend the argument list.
      logArgs.push(...selected.filter((branch) => !branch.startsWith("-")));
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
        // The panel names what each branch tracks and where each remote points.
        upstreams: [
          "for-each-ref",
          "--format=%(refname:short)%1f%(upstream:short)",
          "refs/heads",
        ],
        remotes: ["remote", "--verbose"],
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
          isRepo: succeeded(branchesResult),
          upstreams: parseUpstreams(successText(results.upstreams)),
          remotes: parseRemotes(successText(results.remotes)),
        });
      },
    );
  }

  /**
   * Reads one commit's metadata and changed files.
   *
   * The shared view builds the file tree itself from `fileChanges`, so only the
   * flat change list is produced here.
   */
  loadCommitDetails(
    request: CommitDetailsRequest,
    deliver: (response: QueryResponse) => void,
  ): void {
    const hash = request.commitHash;
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) {
      deliver({ command: "commitDetails", commitDetails: null } as QueryResponse);
      return;
    }
    const separator = "%x1f";
    this.batch(
      request.repo,
      {
        meta: [
          "show",
          "--quiet",
          "--no-color",
          `--format=%H${separator}%P${separator}%an${separator}%ae${separator}%at${separator}%cn${separator}%B`,
          hash,
        ],
        names: ["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", "--root", hash],
        stats: ["diff-tree", "--no-commit-id", "--numstat", "-r", "-M", "--root", hash],
      },
      (results) => {
        const meta = results.meta;
        if (!succeeded(meta)) {
          deliver({ command: "commitDetails", commitDetails: null } as QueryResponse);
          return;
        }
        const details = parseCommitDetails(
          decode(meta.stdout),
          decode(results.names?.stdout),
          decode(results.stats?.stdout),
        );
        deliver({ command: "commitDetails", commitDetails: details } as QueryResponse);
      },
    );
  }

  /**
   * The files that differ between two commits, in the same shape a single
   * commit's changes take, so the panel renders either from one code path.
   *
   * The panel waits for this reply, so a pair it cannot compare is reported as
   * an error rather than left to look like a slow read.
   */
  loadComparison(
    request: CommitComparisonRequest,
    deliver: (response: QueryResponse) => void,
  ): void {
    if (request.repo === "" || !REVISION.test(request.fromHash) || !REVISION.test(request.toHash)) {
      deliver(comparisonError(UNCOMPARABLE_REVISIONS));
      return;
    }
    const shared = ["--no-color", "--no-ext-diff", "-M", "-r"];
    this.batch(
      request.repo,
      {
        names: ["diff", ...shared, "--name-status", request.fromHash, request.toHash],
        stats: ["diff", ...shared, "--numstat", request.fromHash, request.toHash],
      },
      (results) => {
        if (!succeeded(results.names)) {
          deliver(comparisonError(failureText(results.names) || UNCOMPARABLE_REVISIONS));
          return;
        }
        deliver({
          command: "commitComparison",
          fileChanges: parseFileChanges(decode(results.names.stdout), successText(results.stats)),
          error: null,
        } as QueryResponse);
      },
    );
  }

  /**
   * Reads one file's unified diff together with the full text of both
   * endpoints, which is what lets the docked panel show the unchanged
   * remainder of the file around the change.
   *
   * A missing endpoint is a normal outcome — the file exists on only one side
   * of an addition or a deletion — so a failed blob read becomes "not present"
   * instead of an error. Only a failed diff makes the whole file unreadable.
   */
  loadFullDiff(request: FullDiffContentRequest, deliver: (response: QueryResponse) => void): void {
    if (request.repo === "" || !REVISION.test(request.fromHash) || !REVISION.test(request.toHash)) {
      deliver(UNREADABLE_FULL_DIFF as QueryResponse);
      return;
    }
    this.resolveOldRevision(request, (oldRevision) => {
      const paths =
        request.oldFilePath === request.newFilePath
          ? [request.newFilePath]
          : [request.oldFilePath, request.newFilePath];
      const operations: Record<string, string[]> = {
        // The panel parses this output, so rename detection and the built-in
        // diff format are asked for explicitly rather than left to the
        // repository's own configuration. Paths follow `--`, so a name that
        // looks like an option stays a path.
        diff: [
          "diff", "--no-color", "--no-ext-diff", "-M",
          oldRevision, request.toHash, "--", ...paths,
        ],
      };
      if (request.type !== "A") {
        operations.oldBlob = ["show", `${oldRevision}:${request.oldFilePath}`];
      }
      if (request.type !== "D") {
        operations.newBlob = ["show", `${request.toHash}:${request.newFilePath}`];
      }
      this.batch(request.repo, operations, (results) => {
        const oldBlob = readBlob(results.oldBlob);
        const newBlob = readBlob(results.newBlob);
        deliver({
          command: "fullDiffContent",
          diff: succeeded(results.diff) ? decode(results.diff.stdout) : null,
          oldContent: oldBlob.content,
          newContent: newBlob.content,
          oldExists: oldBlob.exists,
          newExists: newBlob.exists,
        } as QueryResponse);
      });
    });
  }

  /**
   * The revision holding the old side of the change: the named one when two
   * commits are compared, otherwise the commit's first parent, or the empty
   * tree when it has none.
   */
  private resolveOldRevision(
    request: FullDiffContentRequest,
    use: (revision: string) => void,
  ): void {
    if (request.fromHash !== request.toHash) {
      use(request.fromHash);
      return;
    }
    // `rev-list --parents -n 1` prints the commit followed by its parents, so a
    // single token means a root commit. This reads the output rather than
    // relying on a non-zero exit, which Git reports inconsistently here.
    this.run(request.repo, ["rev-list", "--parents", "-n", "1", request.fromHash], (result) => {
      const tokens = successText(result).trim().split(/\s+/).filter((token) => token !== "");
      use(tokens.length > 1 ? tokens[1] : EMPTY_TREE);
    });
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

/** Splits `show` metadata and the two diff-tree listings into one detail record. */
function parseCommitDetails(
  meta: string,
  nameStatus: string,
  numStat: string,
): GitCommitDetails | null {
  const fields = meta.split("\u001f");
  if (fields.length < 7) return null;
  const date = Number.parseInt(fields[4], 10);
  if (!Number.isSafeInteger(date)) return null;
  return {
    hash: fields[0],
    parents: fields[1] === "" ? [] : fields[1].split(" "),
    author: fields[2],
    email: fields[3],
    date,
    committer: fields[5],
    // %B is last so an unescaped body cannot swallow later fields.
    body: fields.slice(6).join("\u001f").replace(/\s+$/, ""),
    fileChanges: parseFileChanges(nameStatus, numStat),
  };
}

/** Pairs name-status entries with their numstat counts, keyed by new path. */
function parseFileChanges(nameStatus: string, numStat: string): GitFileChange[] {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of nonEmptyLines(numStat)) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const path = newPathOfCount(parts[parts.length - 1]);
    counts.set(path, {
      additions: parts[0] === "-" ? null : Number.parseInt(parts[0], 10),
      deletions: parts[1] === "-" ? null : Number.parseInt(parts[1], 10),
    });
  }

  const changes: GitFileChange[] = [];
  for (const line of nonEmptyLines(nameStatus)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const type = fileChangeType(parts[0]);
    if (type === null) continue;
    const oldFilePath = parts[1];
    const newFilePath = type === "R" && parts.length > 2 ? parts[2] : parts[1];
    const count = counts.get(newFilePath);
    changes.push({
      oldFilePath,
      newFilePath,
      type,
      additions: count?.additions ?? null,
      deletions: count?.deletions ?? null,
    });
  }
  return changes;
}

/**
 * New path of a numstat entry. A rename is printed as `old => new` or
 * `dir/{old => new}`, and both reduce to the new path, which is how the
 * name-status entries are keyed.
 */
function newPathOfCount(field: string): string {
  return field.replace(/(.*)\{.* => (.*)\}/, "$1$2").replace(/.* => (.*)/, "$1");
}

/** Failure text of a Git read, preferring what Git itself said went wrong. */
function failureText(result: GitResult | undefined): string {
  if (result === undefined) return "";
  const text = decode(result.stderr).trim() || decode(result.stdout).trim();
  return text.split(/\r\n|\r|\n/)[0] ?? "";
}

function comparisonError(error: string): QueryResponse {
  return { command: "commitComparison", fileChanges: [], error } as QueryResponse;
}

function fileChangeType(status: string): GitFileChangeType | null {
  const letter = status.charAt(0).toUpperCase();
  return letter === "A" || letter === "M" || letter === "D" || letter === "R" ? letter : null;
}

function decode(bytes: Uint8Array<ArrayBufferLike> | undefined): string {
  return bytes === undefined ? "" : new TextDecoder().decode(bytes);
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

/** Upstream of each local branch that has one, keyed by branch name. */
function parseUpstreams(output: string): Record<string, string> {
  const upstreams: Record<string, string> = {};
  for (const line of nonEmptyLines(output)) {
    const [branch, upstream] = line.split("\u001f");
    if (branch !== undefined && upstream !== undefined && upstream !== "") {
      upstreams[branch] = upstream;
    }
  }
  return upstreams;
}

/**
 * Fetch URL of each remote, keyed by remote name. `remote --verbose` prints one
 * line per direction, and the fetch URL is the one the panel reports.
 */
function parseRemotes(output: string): Record<string, string> {
  const remotes: Record<string, string> = {};
  for (const line of nonEmptyLines(output)) {
    const match = /^(\S+)\s+(\S.*?)\s+\((fetch|push)\)$/.exec(line);
    if (match !== null && (match[3] === "fetch" || remotes[match[1]] === undefined)) {
      remotes[match[1]] = match[2];
    }
  }
  return remotes;
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

/**
 * One endpoint of a change, absent when its blob could not be read.
 *
 * A blob holding a NUL byte is binary, and the panel shows text, so it counts
 * as absent rather than being handed decoded bytes to render as lines.
 */
function readBlob(result: GitResult | undefined): { exists: boolean; content: string | null } {
  if (!succeeded(result) || result.stdout.includes(0)) {
    return { exists: false, content: null };
  }
  return { exists: true, content: decode(result.stdout) };
}

function succeeded(result: GitResult | undefined): result is GitResult {
  return result !== undefined && result.status === "completed" && result.exitCode === 0;
}

function successText(result: GitResult | undefined): string {
  return succeeded(result) ? decode(result.stdout) : "";
}

function nonEmptyLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : min;
}
