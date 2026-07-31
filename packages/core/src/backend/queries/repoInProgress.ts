import { abbrevCommit } from "@an-dr/commits-core/backend/utils/string";

/** Operation the working tree is part-way through. */
export type RepoInProgressType = "rebase" | "merge" | "cherry-pick" | "revert";

/** How far a multi-commit rebase has got. */
export interface RebaseProgress {
  readonly current: number;
  readonly total: number;
}

/** Which branch a rebase is replaying, and onto what. */
export interface RebaseContext {
  readonly branch: string | null;
  readonly onto: string | null;
}

/** Working-tree totals shown alongside the in-progress state. */
export interface WorkingTreeStatus {
  readonly changed: number;
  readonly staged: number;
  readonly conflicts: number;
  readonly untracked: number;
}

export interface RepoInProgressState {
  readonly type: RepoInProgressType;
  readonly subject: string | null;
  readonly rebaseProgress: RebaseProgress | null;
  readonly rebaseContext: RebaseContext | null;
  readonly workingTreeStatus: WorkingTreeStatus | null;
}

/**
 * Repository access this query needs.
 *
 * Injected rather than taken as a Git client so the parsing below is testable
 * without a repository in each of the four in-progress states.
 */
export interface RepoInProgressIo {
  /** Resolves `git rev-parse --git-path` for each name, in order. */
  resolveGitPaths(names: string[]): Promise<string[] | null>;
  pathExists(target: string): Promise<boolean>;
  readTextFile(target: string): Promise<string | null>;
  /** Output of `git status --porcelain --untracked-files=all`. */
  readStatusPorcelain(): Promise<string | null>;
  /** A branch or tag name pointing at the hash, when one exists. */
  nameCommit(hash: string): Promise<string | null>;
}

const EOL_REGEX = /\r\n|\r|\n/;

/** Porcelain XY codes that mean an unmerged path. */
const CONFLICT_STATES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Longest subject shown before it is elided. */
const MAX_SUBJECT = 120;

/**
 * Counts working-tree entries from `git status --porcelain` output.
 *
 * The XY codes are read directly because an unmerged path and an untracked
 * one have to be told apart: only the former makes the operation conflicted.
 */
export function parseWorkingTreeStatus(stdout: string): WorkingTreeStatus {
  const lines = stdout.split(EOL_REGEX).filter((line) => line !== "");
  let changed = 0,
    staged = 0,
    conflicts = 0,
    untracked = 0;
  for (const line of lines) {
    if (line.length < 2) {
      continue;
    }
    const x = line.substring(0, 1),
      y = line.substring(1, 2),
      xy = x + y;
    if (xy === "??") {
      untracked++;
      continue;
    }
    if (CONFLICT_STATES.has(xy)) {
      conflicts++;
      continue;
    }
    if (x !== " " && x !== "?") {
      staged++;
    }
    if (y !== " " && y !== "?") {
      changed++;
    }
  }
  return { changed, staged, conflicts, untracked };
}

/** First non-comment line of a rebase message file, elided when very long. */
export function pickSubjectLine(content: string | null): string | null {
  if (content === null) {
    return null;
  }
  const subject = content
    .split(EOL_REGEX)
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("#"));
  if (subject === undefined) {
    return null;
  }
  return subject.length > MAX_SUBJECT ? subject.substring(0, MAX_SUBJECT) + "..." : subject;
}

/** Reads a count Git writes as a bare number, or null when it is absent. */
function parseCount(value: string | null): number | null {
  const parsed = value === null ? NaN : parseInt(value.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Strips the refs/heads/ prefix Git writes into the rebase state files. */
function shortenRef(ref: string | null): string | null {
  if (ref === null) {
    return null;
  }
  const trimmed = ref.trim();
  return trimmed === "" ? null : trimmed.replace(/^refs\/heads\//, "");
}

async function readRebaseProgress(
  io: RepoInProgressIo,
  rebasePath: string
): Promise<RebaseProgress | null> {
  // An interactive rebase records msgnum/end; a patch-based one next/last.
  const [msgnum, end, next, last] = await Promise.all([
    io.readTextFile(join(rebasePath, "msgnum")),
    io.readTextFile(join(rebasePath, "end")),
    io.readTextFile(join(rebasePath, "next")),
    io.readTextFile(join(rebasePath, "last"))
  ]);
  const current = parseCount(msgnum) ?? parseCount(next);
  const total = parseCount(end) ?? parseCount(last);
  return current !== null && total !== null ? { current, total } : null;
}

/**
 * Names the branch being rebased and what it is being replayed onto.
 *
 * `onto` holds a hash, so a readable name is preferred: the `onto_name` Git
 * records, then any ref pointing at the commit, and only then an abbreviation.
 */
async function readRebaseContext(io: RepoInProgressIo, rebasePath: string): Promise<RebaseContext> {
  const [branchRef, ontoNameRef, ontoHash] = await Promise.all([
    io.readTextFile(join(rebasePath, "head-name")),
    io.readTextFile(join(rebasePath, "onto_name")),
    io.readTextFile(join(rebasePath, "onto"))
  ]);
  const branch = shortenRef(branchRef);
  if (ontoNameRef !== null) {
    return { branch, onto: shortenRef(ontoNameRef) };
  }
  if (ontoHash === null || ontoHash.trim() === "") {
    return { branch, onto: null };
  }
  const hash = ontoHash.trim();
  const named = await io.nameCommit(hash);
  return { branch, onto: named ?? abbrevCommit(hash) };
}

async function readRebaseSubject(io: RepoInProgressIo, rebasePath: string): Promise<string | null> {
  // Read together, then taken in preference order: the files are independent
  // and a rebase writes different ones depending on how it was started.
  const contents = await Promise.all(
    ["message", "final-commit", "msg-clean"].map((name) => io.readTextFile(join(rebasePath, name)))
  );
  for (const content of contents) {
    const subject = pickSubjectLine(content);
    if (subject !== null) {
      return subject;
    }
  }
  return null;
}

function join(base: string, name: string): string {
  return base.endsWith("/") || base.endsWith("\\") ? base + name : base + "/" + name;
}

async function readWorkingTreeStatus(io: RepoInProgressIo): Promise<WorkingTreeStatus | null> {
  const stdout = await io.readStatusPorcelain();
  return stdout === null ? null : parseWorkingTreeStatus(stdout);
}

/**
 * Reports the operation the repository is part-way through, or null when the
 * working tree is in a normal state.
 *
 * Rebase is checked first because a rebase stopped on a conflict also leaves
 * a MERGE_HEAD behind; reporting that as a merge would offer the user the
 * wrong continue and abort actions.
 */
export async function getRepoInProgressState(
  io: RepoInProgressIo
): Promise<RepoInProgressState | null> {
  const paths = await io.resolveGitPaths([
    "rebase-merge",
    "rebase-apply",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD"
  ]);
  if (paths === null || paths.length < 5) {
    return null;
  }
  const [rebaseMerge, rebaseApply, mergeHead, cherryPickHead, revertHead] = paths;

  const hasRebaseMerge = await io.pathExists(rebaseMerge);
  const rebasePath = hasRebaseMerge
    ? rebaseMerge
    : (await io.pathExists(rebaseApply))
      ? rebaseApply
      : null;
  if (rebasePath !== null) {
    return {
      type: "rebase",
      subject: await readRebaseSubject(io, rebasePath),
      rebaseProgress: await readRebaseProgress(io, rebasePath),
      rebaseContext: await readRebaseContext(io, rebasePath),
      workingTreeStatus: await readWorkingTreeStatus(io)
    };
  }

  const heads: Array<[string, RepoInProgressType]> = [
    [cherryPickHead, "cherry-pick"],
    [revertHead, "revert"],
    [mergeHead, "merge"]
  ];
  // Probed together; the order of `heads` still decides which one wins when
  // more than one marker is present.
  const present = await Promise.all(heads.map(([file]) => io.pathExists(file)));
  const match = heads.find((_, i) => present[i]);
  if (match === undefined) {
    return null;
  }
  return {
    type: match[1],
    subject: null,
    rebaseProgress: null,
    rebaseContext: null,
    workingTreeStatus: await readWorkingTreeStatus(io)
  };
}
