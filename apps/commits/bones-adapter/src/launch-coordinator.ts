import type { LaunchRequest } from "@commits/ipc/native";
import type { NavigationTarget } from "./navigation";

/**
 * Where the window is in taking a launch:
 *
 * - `booting` until the component has read its own startup request;
 * - `loading` while a repository's graph is being read, or a newly selected
 *   repository has not finished its first read;
 * - `ready` otherwise, when a launch or navigation can apply at once.
 */
export type LaunchPhase = "booting" | "loading" | "ready";

/** What the coordinator asks its owner to do; it holds no repository state itself. */
export interface LaunchEffects {
  /** Opens the launch's repositories and applies its appearance, then calls {@link LaunchCoordinator.launchApplied}. */
  applyLaunch(request: LaunchRequest): void;
  /** Selects a navigation target in the repository that is open now. */
  navigate(target: NavigationTarget): void;
}

/**
 * Decides when a launch and its navigation apply.
 *
 * A handoff can arrive at any moment: before startup has finished, while a
 * graph is still loading, or when the window is idle. Applying it mid-load
 * would race the load, so it waits, and only the newest waiting launch is
 * kept. Navigation waits the same way, because a target can only be selected
 * in a graph that has finished loading.
 */
export class LaunchCoordinator {
  private started = false;
  private loads = 0;
  private awaitingFirstLoad = false;
  private lastSequence = -1;
  private pendingLaunch: LaunchRequest | null = null;
  private pendingNavigation: NavigationTarget | null = null;
  private generation = 0;

  constructor(private readonly effects: LaunchEffects) {}

  get phase(): LaunchPhase {
    if (!this.started) return "booting";
    return this.loads > 0 || this.awaitingFirstLoad ? "loading" : "ready";
  }

  /**
   * Takes the startup request, unless a newer handoff already arrived while
   * booting, and returns the launch startup should apply.
   */
  start(startup: LaunchRequest): LaunchRequest {
    const launch = this.pendingLaunch ?? startup;
    this.pendingLaunch = null;
    this.lastSequence = launch.sequence ?? 0;
    this.started = true;
    this.pendingNavigation = launch;
    return launch;
  }

  /** A handoff from a later `commits` run; older sequences are ignored. */
  receive(request: LaunchRequest): void {
    const sequence = request.sequence ?? 0;
    if (sequence <= this.lastSequence) return;
    this.lastSequence = sequence;
    if (this.phase !== "ready") {
      this.pendingLaunch = request;
      return;
    }
    this.effects.applyLaunch(request);
  }

  /**
   * Called by the owner once it has applied a launch's repositories and
   * appearance, to decide whether the launch's navigation runs now.
   */
  launchApplied(request: LaunchRequest, opened: { readonly repositoryChanged: boolean; readonly hasRepository: boolean }): void {
    this.generation++;
    if (request.kind === "repository" && !opened.repositoryChanged && this.phase === "ready") {
      this.effects.navigate(request);
    } else if (request.kind === "none" && opened.hasRepository) {
      this.requestNavigation(request);
    } else {
      this.pendingNavigation = request;
    }
  }

  /** Navigates now when the graph is settled, otherwise once it is. */
  requestNavigation(target: NavigationTarget): void {
    if (this.phase === "loading") {
      this.pendingNavigation = target;
      return;
    }
    this.effects.navigate(target);
  }

  /** A different repository became current; its first load has yet to finish. */
  repositoryChanged(): void {
    this.generation++;
    this.awaitingFirstLoad = true;
  }

  loadStarted(): void {
    this.loads++;
  }

  /**
   * A graph load finished. Once nothing is loading, the newest waiting launch
   * applies first; otherwise the waiting navigation does.
   */
  loadFinished(forCurrentRepository: boolean): void {
    this.loads--;
    if (forCurrentRepository) this.awaitingFirstLoad = false;
    if (this.loads > 0) return;
    if (this.pendingLaunch) {
      const launch = this.pendingLaunch;
      this.pendingLaunch = null;
      this.effects.applyLaunch(launch);
    } else if (this.pendingNavigation) {
      const navigation = this.pendingNavigation;
      this.pendingNavigation = null;
      this.requestNavigation(navigation);
    }
  }

  /**
   * Starts an asynchronous navigation step. Its answer still applies only if
   * {@link isCurrent} holds, so a newer launch or repository wins.
   */
  beginNavigationStep(): number {
    return ++this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}
