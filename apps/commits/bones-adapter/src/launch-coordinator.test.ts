import { describe, expect, it } from "vitest";
import type { LaunchRequest } from "@commits/ipc/native";
import { LaunchCoordinator } from "./launch-coordinator";
import type { NavigationTarget } from "./navigation";

function coordinator(): { launches: LaunchCoordinator; applied: LaunchRequest[]; navigated: NavigationTarget[] } {
  const applied: LaunchRequest[] = [];
  const navigated: NavigationTarget[] = [];
  const launches = new LaunchCoordinator({
    applyLaunch: (request) => applied.push(request),
    navigate: (target) => navigated.push(target),
  });
  return { launches, applied, navigated };
}

const repository = (path: string, sequence: number, extra: Partial<LaunchRequest> = {}): LaunchRequest =>
  ({ kind: "repository", paths: [path], sequence, ...extra }) as LaunchRequest;

describe("LaunchCoordinator", () => {
  it("prefers a handoff received while booting over the startup request", () => {
    const { launches, applied } = coordinator();
    expect(launches.phase).toBe("booting");
    launches.receive(repository("C:/B", 1));
    expect(applied).toEqual([]);
    expect(launches.start(repository("C:/A", 0))).toMatchObject({ paths: ["C:/B"] });
    expect(launches.phase).toBe("ready");
  });

  it("ignores handoffs older than the newest one seen", () => {
    const { launches, applied } = coordinator();
    launches.start({ kind: "none", sequence: 0 });
    launches.receive(repository("C:/B", 2));
    launches.receive(repository("C:/A", 1));
    expect(applied.map((request) => request.sequence)).toEqual([2]);
  });

  it("keeps only the newest handoff while a load runs and applies it when the load ends", () => {
    const { launches, applied } = coordinator();
    launches.start({ kind: "none", sequence: 0 });
    launches.loadStarted();
    expect(launches.phase).toBe("loading");
    launches.receive(repository("C:/B", 1));
    launches.receive(repository("C:/C", 2));
    expect(applied).toEqual([]);
    launches.loadFinished("C:/A", "C:/A");
    expect(applied.map((request) => request.sequence)).toEqual([2]);
  });

  it("waits for a newly selected repository's first load before navigating", () => {
    const { launches, navigated } = coordinator();
    launches.start({ kind: "none", sequence: 0 });
    launches.repositoryChanged();
    launches.requestNavigation({ branch: "main" }, "C:/A");
    expect(navigated).toEqual([]);
    launches.loadStarted();
    launches.loadFinished("C:/A", "C:/A");
    expect(navigated).toEqual([{ branch: "main" }]);
  });

  it("navigates at once into a repository that is already open and loaded", () => {
    const { launches, navigated } = coordinator();
    launches.start({ kind: "none", sequence: 0 });
    launches.launchApplied(repository("C:/A", 1, { commit: "abcd" }), { repository: "C:/A", repositoryChanged: false });
    expect(navigated).toMatchObject([{ commit: "abcd" }]);
  });

  it("drops the navigation of a rejected launch instead of applying it to the open repository", () => {
    const { launches, navigated } = coordinator();
    launches.start({ kind: "none", sequence: 0 });
    launches.loadStarted();
    launches.launchApplied({ kind: "rejected", reason: "nothing at C:/missing", sequence: 1, branch: "x" }, { repository: "C:/A", repositoryChanged: false });
    launches.loadFinished("C:/A", "C:/A");
    expect(navigated).toEqual([]);
  });

  it("drops startup flags when no repository opened", () => {
    const { launches, navigated } = coordinator();
    launches.launchApplied(launches.start({ kind: "none", sequence: 0, commit: "abcd" }), { repository: null, repositoryChanged: true });
    launches.repositoryChanged();
    launches.loadStarted();
    launches.loadFinished("C:/picked", "C:/picked");
    expect(navigated).toEqual([]);
  });

  it("drops a waiting navigation when a different repository loads first", () => {
    const { launches, navigated } = coordinator();
    launches.start({ kind: "none", sequence: 0 });
    launches.launchApplied(repository("C:/A", 1, { branch: "main" }), { repository: "C:/A", repositoryChanged: true });
    launches.loadStarted();
    launches.loadFinished("C:/B", "C:/B");
    expect(navigated).toEqual([]);
  });

  it("makes an earlier navigation step stale once a newer one begins", () => {
    const { launches } = coordinator();
    const first = launches.beginNavigationStep();
    const second = launches.beginNavigationStep();
    expect(launches.isCurrent(first)).toBe(false);
    expect(launches.isCurrent(second)).toBe(true);
  });
});
