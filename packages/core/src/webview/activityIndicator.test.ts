import { beforeAll, describe, expect, it } from "vitest";
import type { RequestMessage, ResponseMessage } from "../types";
import { ActivityTracker, activityTooltip, requestLabel } from "./activityIndicator";

/** Answers every string lookup with its own key, so a test can assert on it. */
const l10nStub = new Proxy(
  {},
  {
    get: (_target, key) => {
      const name = String(key);
      return name === "activityReadyAfter" ? "Ready · last: {0}" : name;
    }
  }
);

beforeAll(() => {
  (globalThis as Record<string, unknown>).l10n = l10nStub;
});

const NOW = 1_700_000_000_000;

describe("activity indicator", () => {
  it("names the work a tracked request starts", () => {
    expect(requestLabel(<RequestMessage>{ command: "loadCommits" })).toBe("activityLoadingCommits");
    expect(requestLabel(<RequestMessage>{ command: "commitChanges" })).toBe("activityCommitting");
  });

  it("tells the three remote operations apart by their payload", () => {
    const remote = (operation: string) =>
      requestLabel(<RequestMessage>{ command: "remoteOperation", operation });

    expect(remote("fetch")).toBe("activityFetching");
    expect(remote("pull")).toBe("activityPulling");
    expect(remote("push")).toBe("activityPushing");
  });

  it("stays quiet for requests that are not work the user waits on", () => {
    expect(requestLabel(<RequestMessage>{ command: "saveRepoState" })).toBeNull();
    expect(requestLabel(<RequestMessage>{ command: "fetchAvatar" })).toBeNull();
  });

  it("is idle until a tracked request is sent, and again once it is answered", () => {
    const tracker = new ActivityTracker();

    expect(tracker.busy(NOW)).toBe(false);
    expect(tracker.begin(<RequestMessage>{ command: "pushBranch" }, NOW)).toBe(true);
    expect(tracker.busy(NOW)).toBe(true);
    expect(tracker.settle(<ResponseMessage>{ command: "pushBranch" })).toBe("activityPushing");
    expect(tracker.busy(NOW)).toBe(false);
  });

  it("ignores an untracked request and a response for nothing in flight", () => {
    const tracker = new ActivityTracker();

    expect(tracker.begin(<RequestMessage>{ command: "saveRepoState" }, NOW)).toBe(false);
    expect(tracker.busy(NOW)).toBe(false);
    expect(tracker.settle(<ResponseMessage>{ command: "refresh" })).toBeNull();
  });

  it("reports every kind of work running at once, oldest first, without repeats", () => {
    const tracker = new ActivityTracker();

    tracker.begin(<RequestMessage>{ command: "loadCommits" }, NOW);
    tracker.begin(<RequestMessage>{ command: "loadBranches" }, NOW);
    tracker.begin(<RequestMessage>{ command: "pushTag" }, NOW);
    tracker.begin(<RequestMessage>{ command: "pushBranch" }, NOW);

    expect(tracker.labels(NOW)).toEqual([
      "activityLoadingCommits",
      "activityLoadingBranches",
      "activityPushing"
    ]);
  });

  it("gives up on a request the host never answers", () => {
    const tracker = new ActivityTracker();

    tracker.begin(<RequestMessage>{ command: "runTool" }, NOW);

    expect(tracker.busy(NOW + 60_000)).toBe(true);
    expect(tracker.busy(NOW + 6 * 60_000)).toBe(false);
  });

  it("expires against the oldest request's own deadline, not the newest", () => {
    const tracker = new ActivityTracker();

    tracker.begin(<RequestMessage>{ command: "runTool" }, NOW);
    tracker.begin(<RequestMessage>{ command: "loadCommits" }, NOW + 60_000);

    expect(tracker.nextExpiry(NOW + 60_000)).toBe(4 * 60_000);
    expect(tracker.nextExpiry(NOW)).toBe(5 * 60_000);
  });

  it("has nothing to expire while nothing is in flight", () => {
    expect(new ActivityTracker().nextExpiry(NOW)).toBeNull();
  });

  it("tooltips the running work, or names the last thing that finished", () => {
    expect(activityTooltip(["activityPushing", "activityLoadingCommits"], null)).toBe(
      "activityPushing\nactivityLoadingCommits"
    );
    expect(activityTooltip([], null)).toBe("activityReady");
    expect(activityTooltip([], "activityPushing")).toBe("Ready · last: activityPushing");
  });
});
