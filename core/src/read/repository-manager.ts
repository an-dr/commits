/** A repository known to the host-agnostic read backend. */
export interface ManagedRepository {
  readonly id: string;
  readonly path: string;
  readonly source: "host" | "external";
}

/** Only the host supplies paths; Git verification happens in the read backend. */
export interface RepositoryPathSource {
  repositoryPaths(): readonly string[];
}

/**
 * Reconciles transient host paths with user-chosen external repositories.
 *
 * Nested paths are intentionally preserved: a Git worktree inside another
 * checkout is a distinct repository, not a duplicate workspace folder.
 */
export class RepositoryManager {
  private readonly external = new Map<string, ManagedRepository>();
  private readonly host = new Map<string, ManagedRepository>();

  constructor(private readonly paths: RepositoryPathSource) {}

  discover(): readonly ManagedRepository[] {
    const next = new Map<string, ManagedRepository>();
    for (const path of this.paths.repositoryPaths()) {
      const repository = toRepository(path, "host");
      if (repository !== null && !next.has(repository.id)) next.set(repository.id, repository);
    }
    this.host.clear();
    for (const [id, repository] of next) this.host.set(id, repository);
    return this.all();
  }

  addExternal(path: string): ManagedRepository | null {
    const repository = toRepository(path, "external");
    if (repository !== null) this.external.set(repository.id, repository);
    return repository;
  }

  removeExternal(id: string): void { this.external.delete(id); }

  all(): readonly ManagedRepository[] {
    const repositories = new Map(this.host);
    // Explicitly chosen paths are still shown when a launcher also exposes it.
    for (const [id, repository] of this.external) repositories.set(id, repository);
    return [...repositories.values()].sort((left, right) => left.path.localeCompare(right.path));
  }
}

function toRepository(path: string, source: ManagedRepository["source"]): ManagedRepository | null {
  const trimmed = path.trim();
  if (trimmed.length === 0) return null;
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.length === 0) return null;
  return {
    id: normalized.toLocaleLowerCase("en-US"),
    path: normalized,
    source,
  };
}
