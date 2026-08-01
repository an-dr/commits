import type {
  Disposable,
  RootPathsChange,
  WorkspacePort,
} from "@an-dr/commits-core/host/port";
import type { HostPort as BonesHostPort } from "./host-port";

const NOOP_DISPOSABLE: Disposable = { dispose() {} };

/**
 * Exposes the repository paths supplied by bones through the shared MIT
 * core's workspace contract.
 *
 * The current bones ABI supplies a snapshot rather than change events or an
 * active-editor hint. Those optional signals therefore remain quiet until the
 * native host grows matching capabilities.
 */
export class CommitsCoreWorkspacePort implements WorkspacePort {
  constructor(private readonly bones: Pick<BonesHostPort, "repositoryPaths">) {}

  getRootPaths(): string[] {
    return [...this.bones.repositoryPaths()];
  }

  onDidChangeRootPaths(_listener: (change: RootPathsChange) => void): Disposable {
    return NOOP_DISPOSABLE;
  }

  getActiveRepoHint(): string | null {
    return null;
  }

  onDidChangeActiveRepoHint(_listener: () => void): Disposable {
    return NOOP_DISPOSABLE;
  }
}
