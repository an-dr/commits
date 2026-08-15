export interface CacheableCommit { readonly hash: string; }

interface Entry<T> { readonly generation: number; readonly value: T; }
interface Repository<TCommit, TProjection> {
  generation: number;
  unverified: boolean;
  commits: Map<string, TCommit>;
  projections: Map<string, Entry<TProjection>>;
}

/** Keeps a bounded LRU of commits and exact graph projections per repository. */
export class RepositoryGraphCache<TCommit extends CacheableCommit, TProjection> {
  private readonly repositories = new Map<string, Repository<TCommit, TProjection>>();

  constructor(
    private readonly maxCommits = 20_000,
    private readonly maxProjections = 24,
  ) {}

  getProjection(repository: string, key: string): { value: TProjection; stale: boolean } | null {
    const state = this.repositories.get(repository);
    const entry = state?.projections.get(key);
    if (state === undefined || entry === undefined) return null;
    state.projections.delete(key);
    state.projections.set(key, entry);
    return { value: entry.value, stale: state.unverified || entry.generation !== state.generation };
  }

  setProjection(repository: string, key: string, commits: readonly TCommit[], value: TProjection): void {
    const state = this.state(repository);
    for (const commit of commits) {
      state.commits.delete(commit.hash);
      state.commits.set(commit.hash, commit);
    }
    trim(state.commits, this.maxCommits);
    state.projections.delete(key);
    state.projections.set(key, { generation: state.generation, value });
    trim(state.projections, this.maxProjections);
  }

  setForGeneration(repository: string, key: string, generation: number, commits: readonly TCommit[], value: TProjection): boolean {
    if (this.state(repository).generation !== generation) return false;
    this.setProjection(repository, key, commits, value);
    return true;
  }

  getCommit(repository: string, hash: string): TCommit | null {
    const commits = this.repositories.get(repository)?.commits;
    const commit = commits?.get(hash);
    if (commits === undefined || commit === undefined) return null;
    commits.delete(hash);
    commits.set(hash, commit);
    return commit;
  }

  markUnverified(repository: string): void { this.state(repository).unverified = true; }
  confirmVerified(repository: string): void { this.state(repository).unverified = false; }
  advanceGeneration(repository: string): void {
    const state = this.state(repository);
    state.generation += 1;
    state.unverified = false;
  }
  generation(repository: string): number { return this.state(repository).generation; }
  delete(repository: string): void { this.repositories.delete(repository); }

  private state(repository: string): Repository<TCommit, TProjection> {
    let state = this.repositories.get(repository);
    if (state === undefined) {
      state = { generation: 0, unverified: false, commits: new Map(), projections: new Map() };
      this.repositories.set(repository, state);
    }
    return state;
  }
}

function trim<TKey, TValue>(map: Map<TKey, TValue>, limit: number): void {
  while (map.size > Math.max(1, limit)) map.delete(map.keys().next().value as TKey);
}
