import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { GitFileChangeType, QueryResult } from "@an-dr/commits-core/backend/types";
import type { SimpleGit } from "simple-git";

/** Hash the webview uses for the synthetic uncommitted-changes row. */
export const UNCOMMITTED = "*";

/**
 * Git's empty tree. Diffing a parentless commit against it shows every file as
 * added, where `<hash>^` would simply fail to resolve.
 */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

type FullDiffContentInput = {
  repo: string;
  fromHash: string;
  toHash: string;
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
};

type FileRead = { exists: boolean; content: string | null };

const MISSING: FileRead = { exists: false, content: null };

/**
 * Reads a blob at a revision. A missing path is a normal outcome — the file may
 * not exist on one side of the change — so a Git failure becomes "not present"
 * rather than an error.
 */
async function readCommitFile(git: SimpleGit, revision: string, filePath: string) {
  try {
    return { exists: true, content: await git.show([`${revision}:${filePath}`]) };
  } catch {
    return MISSING;
  }
}

/** Reads the on-disk file, used when the new side is the working tree. */
async function readWorkingTreeFile(repo: string, filePath: string): Promise<FileRead> {
  // The path arrives over the message port. Git does not emit traversing paths,
  // so this only keeps a malformed one from reading outside the repository.
  const resolved = path.resolve(repo, filePath);
  const root = path.resolve(repo);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return MISSING;
  }
  try {
    return { exists: true, content: await fs.readFile(resolved, "utf8") };
  } catch {
    return MISSING;
  }
}

/**
 * The revision holding the old side of a single-commit change: its parent, or
 * the empty tree when the commit has none.
 */
async function resolveParent(git: SimpleGit, hash: string): Promise<string> {
  try {
    // `rev-list --parents -n 1` prints the commit followed by its parents, so a
    // single token means a root commit. This reads the output rather than
    // relying on a non-zero exit, which Git reports inconsistently here.
    const line = await git.raw(["rev-list", "--parents", "-n", "1", hash]);
    return line.trim().split(/\s+/).length > 1 ? `${hash}^` : EMPTY_TREE;
  } catch {
    return EMPTY_TREE;
  }
}

/** Both endpoints of the change, chosen by which revisions the request names. */
async function readEndpoints(
  git: SimpleGit,
  input: FullDiffContentInput,
  oldRevision: string
): Promise<{ oldFile: FileRead; newFile: FileRead }> {
  const againstWorkingTree = input.toHash === UNCOMMITTED;

  const [oldFile, newFile] = await Promise.all([
    input.type === "A" ? MISSING : readCommitFile(git, oldRevision, input.oldFilePath),
    input.type === "D"
      ? MISSING
      : againstWorkingTree
        ? readWorkingTreeFile(input.repo, input.newFilePath)
        : readCommitFile(git, input.toHash, input.newFilePath)
  ]);
  return { oldFile, newFile };
}

/** Unified diff for the single file, as Git prints it. */
async function readFileDiff(
  git: SimpleGit,
  input: FullDiffContentInput,
  oldRevision: string
): Promise<string | null> {
  const range =
    input.fromHash === input.toHash
      ? input.toHash === UNCOMMITTED
        ? ["HEAD"]
        : [oldRevision, input.toHash]
      : [input.fromHash, input.toHash === UNCOMMITTED ? "" : input.toHash].filter(
          (revision) => revision !== ""
        );
  try {
    return await git.raw([
      "diff",
      ...range,
      "--",
      ...(input.oldFilePath === input.newFilePath
        ? [input.newFilePath]
        : [input.oldFilePath, input.newFilePath])
    ]);
  } catch {
    return null;
  }
}

/**
 * Collects everything the in-webview diff panel needs for one file: the unified
 * diff plus the full text of both endpoints, so the panel can show unchanged
 * context the diff itself omits.
 */
export async function fullDiffContent(
  git: SimpleGit,
  input: FullDiffContentInput
): Promise<QueryResult<"fullDiffContent">> {
  // Both the diff and the old endpoint need the same old-side revision, and
  // resolving it costs a Git call, so it is resolved once here.
  const oldRevision =
    input.fromHash === input.toHash
      ? input.toHash === UNCOMMITTED
        ? "HEAD"
        : await resolveParent(git, input.fromHash)
      : input.fromHash;
  const [diff, endpoints] = await Promise.all([
    readFileDiff(git, input, oldRevision),
    readEndpoints(git, input, oldRevision)
  ]);
  return {
    diff,
    oldContent: endpoints.oldFile.content,
    newContent: endpoints.newFile.content,
    oldExists: endpoints.oldFile.exists,
    newExists: endpoints.newFile.exists
  };
}
