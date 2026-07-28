import type { Commit, RefSnapshot } from "./models";

const MAX_PARSE_BYTES = 128 * 1024;

/** Parses bounded machine-readable Git output; callers must page larger logs. */
export function parseLog(output: string, separator = "\u001f"): Commit[] {
  assertBounded(output);
  const commits: Commit[] = [];
  for (const line of output.split(/\r\n|\r|\n/)) {
    if (line === "") continue;
    const fields = line.split(separator);
    if (fields.length !== 6 || !/^[0-9a-f]{7,64}$/i.test(fields[0])) continue;
    const date = Number.parseInt(fields[4], 10);
    if (!Number.isSafeInteger(date)) continue;
    commits.push({
      hash: fields[0],
      parents: fields[1] === "" ? [] : fields[1].split(" "),
      author: fields[2],
      email: fields[3],
      date,
      subject: fields[5],
    });
  }
  return commits;
}

/** Parses a single `for-each-ref` snapshot emitted with a caller-selected separator. */
export function parseRefSnapshot(
  output: string,
  head: string | null,
  separator = "\u001f",
): RefSnapshot {
  assertBounded(output);
  const branches: { name: string; hash: string }[] = [];
  const tags: { name: string; hash: string; annotated: boolean }[] = [];
  const remotes: { name: string; hash: string }[] = [];
  for (const line of output.split(/\r\n|\r|\n/)) {
    const fields = line.split(separator);
    if (fields.length !== 3) continue;
    const [hash, name, peeled] = fields;
    if (!/^[0-9a-f]{7,64}$/i.test(hash)) continue;
    if (name.startsWith("refs/heads/")) branches.push({ name: name.slice(11), hash });
    else if (name.startsWith("refs/tags/")) {
      tags.push({ name: name.slice(10), hash: peeled || hash, annotated: peeled !== "" });
    } else if (name.startsWith("refs/remotes/")) {
      remotes.push({ name: name.slice(13), hash });
    }
  }
  return { head, branches, tags, remotes };
}

function assertBounded(output: string): void {
  if (new TextEncoder().encode(output).byteLength > MAX_PARSE_BYTES) {
    throw new RangeError("Git output exceeds the component parser budget");
  }
}
