import type {
  GitCommitDetails,
  GitCommitNode,
  GitFileChange,
  GitFileChangeType
} from "./git.types";

type QueryPayloads = {
  commitComparison: {
    request: { repo: string; fromHash: string; toHash: string };
    response: { fileChanges: GitFileChange[]; error: string | null };
  };
  commitDetails: {
    request: { repo: string; commitHash: string };
    response: { commitDetails: GitCommitDetails | null };
  };
  fullDiffContent: {
    request: {
      repo: string;
      fromHash: string;
      toHash: string;
      oldFilePath: string;
      newFilePath: string;
      type: GitFileChangeType;
    };
    response: {
      diff: string | null;
      oldContent: string | null;
      newContent: string | null;
      oldExists: boolean;
      newExists: boolean;
    };
  };
  loadBranches: {
    request: { showRemoteBranches: boolean; hard: boolean };
    response: { branches: string[]; head: string | null; hard: boolean; isRepo: boolean };
  };
  loadCommits: {
    request: {
      repo: string;
      branchName: string;
      maxCommits: number;
      showRemoteBranches: boolean;
      hard: boolean;
    };
    response: {
      commits: GitCommitNode[];
      head: string | null;
      moreCommitsAvailable: boolean;
      hard: boolean;
    };
  };
};

export type QueryRequest = {
  [K in keyof QueryPayloads]: { command: K } & QueryPayloads[K]["request"];
}[keyof QueryPayloads];

export type QueryResponse = {
  [K in keyof QueryPayloads]: { command: K } & QueryPayloads[K]["response"];
}[keyof QueryPayloads];

export type QueryResult<T extends keyof QueryPayloads> = QueryPayloads[T]["response"];
