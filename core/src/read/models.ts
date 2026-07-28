export interface Commit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly date: number;
  readonly subject: string;
}

export interface RefSnapshot {
  readonly head: string | null;
  readonly branches: readonly { name: string; hash: string }[];
  readonly tags: readonly { name: string; hash: string; annotated: boolean }[];
  readonly remotes: readonly { name: string; hash: string }[];
}

export interface RepositoryInfo {
  readonly path: string;
  readonly head: string | null;
  readonly refs: RefSnapshot;
}
