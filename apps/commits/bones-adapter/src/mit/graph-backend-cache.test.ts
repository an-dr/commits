import { describe, expect, it } from "vitest";
import type { QueryResponse } from "@an-dr/commits-core/backend/types";
import type { GitResult, GitRun } from "@commits/ipc/native";
import { MitGraphBackend } from "./graph-backend";

type LoadCommits = Extract<QueryResponse, { command: "loadCommits" }>;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Answers Git from canned output, recording what was asked.
 *
 * The cache is about which commands run a second time, so the double is what
 * the test actually measures: a fake repository would prove nothing that
 * counting the log invocations does not.
 */
class GitDouble {
  readonly commands: string[][] = [];
  status = "";
  log = "";
  /** `show-ref -d --head` output; HEAD must resolve or there is no row to hang
   *  the uncommitted changes from. */
  refs = "aaa HEAD\naaa refs/heads/main\n";

  constructor(private readonly backend: () => MitGraphBackend) {}

  runGit(request: GitRun): void {
    this.commands.push(request.args);
    const name = request.args[0];
    const stdout =
      name === "log"
        ? this.log
        : name === "status"
          ? this.status
          : name === "show-ref"
            ? this.refs
            : "";
    this.backend().receive(<GitResult>{
      requestId: request.requestId,
      status: "completed",
      exitCode: 0,
      stdout: encode(stdout),
      stderr: new Uint8Array(),
    });
  }

  /** Every git subcommand run so far, in order. */
  names(): string[] {
    return this.commands.map((args) => args[0]);
  }
}

/** One commit in the format the log request asks for. */
const logLine = (hash: string, message: string): string =>
  `${hash}\u001f\u001f${"Dev"}\u001fdev@example.test\u001f1700000000\u001f${message}\n`;

function makeBackend(): { backend: MitGraphBackend; git: GitDouble } {
  let backend: MitGraphBackend;
  const git = new GitDouble(() => backend);
  backend = new MitGraphBackend({ runGit: (request) => git.runGit(request) });
  return { backend, git };
}

const load = (backend: MitGraphBackend, repo = "C:/repo"): LoadCommits => {
  let response: LoadCommits | undefined;
  backend.loadCommits(
    {
      command: "loadCommits",
      repo,
      branchName: "main",
      branches: ["main"],
      maxCommits: 50,
      showRemoteBranches: false,
      hard: false,
    },
    (value) => {
      response = <LoadCommits>value;
    },
  );
  return response!;
};

describe("MitGraphBackend history cache", () => {
  it("reads the log once for repeated requests of the same history", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");

    load(backend);
    load(backend);

    expect(git.names().filter((name) => name === "log")).toHaveLength(1);
  });

  it("still reads the working tree on every request", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");

    load(backend);
    load(backend);

    expect(git.names().filter((name) => name === "status")).toHaveLength(2);
  });

  it("reports the current uncommitted count on a cached read", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");
    git.status = " M one.ts\n";

    const first = load(backend);
    git.status = " M one.ts\n M two.ts\n";
    const second = load(backend);

    expect(first.commits[0].message).toBe("Uncommitted Changes (1)");
    expect(second.commits[0].message).toBe("Uncommitted Changes (2)");
  });

  it("drops the uncommitted row again once the tree is clean", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");
    git.status = " M one.ts\n";

    load(backend);
    git.status = "";
    const clean = load(backend);

    expect(clean.commits.every((commit) => commit.hash !== "*")).toBe(true);
  });

  it("does not accumulate the uncommitted row across reads of one cached history", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");
    git.status = " M one.ts\n";

    load(backend);
    const second = load(backend);

    expect(second.commits.filter((commit) => commit.hash === "*")).toHaveLength(1);
  });

  it("reads the log again after the repository is invalidated", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");

    load(backend);
    backend.invalidate("C:/repo");
    load(backend);

    expect(git.names().filter((name) => name === "log")).toHaveLength(2);
  });

  it("keeps one repository's history when another is invalidated", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first");

    load(backend, "C:/one");
    backend.invalidate("C:/two");
    load(backend, "C:/one");

    expect(git.names().filter((name) => name === "log")).toHaveLength(1);
  });

  it("serves a later request the rows the earlier one saw", () => {
    const { backend, git } = makeBackend();
    git.log = logLine("aaa", "first") + logLine("bbb", "second");

    const first = load(backend);
    const second = load(backend);

    expect(second.commits.map((commit) => commit.hash)).toEqual(
      first.commits.map((commit) => commit.hash),
    );
  });
});
