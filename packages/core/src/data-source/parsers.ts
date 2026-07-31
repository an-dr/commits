import { BlameLineInfo } from "./models";

/** The all-zero hash Git reports for lines that are not yet committed. */
const UNCOMMITTED_HASH = "0000000000000000000000000000000000000000";

/**
 * Parses `git blame --incremental` output into per-line authorship.
 *
 * The incremental format reports each commit's metadata once, then refers back
 * to that commit by hash for later line ranges, so commit details are cached
 * as they are seen and reused for subsequent groups.
 *
 * Line numbers in the returned map are zero-based, matching editor positions
 * rather than Git's one-based output.
 */
export function parseBlameIncrementalOutput(stdout: string): ReadonlyMap<number, BlameLineInfo> {
  const lines = stdout.split(/\r\n|\r|\n/g);
  const commitInfo = new Map<string, Omit<BlameLineInfo, "hash" | "committed">>();
  const result = new Map<number, BlameLineInfo>();

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^([0-9a-f]{40}) \d+ (\d+) (\d+)$/);
    if (header === null) {
      continue;
    }

    const hash = header[1];
    const finalLine = parseInt(header[2], 10) - 1;
    const lineCount = parseInt(header[3], 10);

    const previous = commitInfo.get(hash);
    let author = previous?.author ?? "";
    let authorEmail = previous?.authorEmail ?? "";
    let authorTime = previous?.authorTime ?? 0;
    let summary = previous?.summary ?? "";

    for (i++; i < lines.length && !lines[i].startsWith("filename "); i++) {
      if (lines[i].startsWith("author ")) {
        author = lines[i].substring(7);
      } else if (lines[i].startsWith("author-mail ")) {
        authorEmail = lines[i].substring(12).replace(/^<|>$/g, "");
      } else if (lines[i].startsWith("author-time ")) {
        authorTime = parseInt(lines[i].substring(12), 10) || 0;
      } else if (lines[i].startsWith("summary ")) {
        summary = lines[i].substring(8);
      }
    }

    commitInfo.set(hash, { author, authorEmail, authorTime, summary });
    const info: BlameLineInfo = {
      author,
      authorEmail,
      authorTime,
      committed: hash !== UNCOMMITTED_HASH,
      hash,
      summary
    };
    for (let offset = 0; offset < lineCount; offset++) {
      result.set(finalLine + offset, info);
    }
  }

  return result;
}
