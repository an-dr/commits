import type { RequestMessage, ResponseMessage } from "@an-dr/commits-core/types";
import type { LocalizedStrings } from "./l10nContract";
import { observeMessagesSent } from "./utils/host";

/**
 * The toolbar's ready/busy light, sitting beside the repo selector.
 *
 * Nothing in the view reports "the app is working" on its own: an action
 * either opens a modal running-dialog or runs silently, so a push started from
 * a context menu looks exactly like an idle app until the graph reloads. This
 * watches the message channel instead of the call sites -- every request the
 * view sends is registered here, and the response carrying the same `command`
 * settles it -- so a new request is covered the day it is added, as long as it
 * is named in `ACTIVITY_LABELS` below.
 */

/**
 * How long a request may stay unanswered before it stops counting as work in
 * progress. A host that never replies (or replies with a command the view does
 * not recognize) would otherwise leave the light spinning for the rest of the
 * session, which is worse than under-reporting a slow fetch.
 */
const STALE_REQUEST_MS = 5 * 60 * 1000;

/**
 * The requests worth showing a light for, and what to call each of them.
 * The background reads a refresh fires off beside its real work -- avatars,
 * the in-progress poll, the submodule poll -- are left out on purpose: the
 * branch and commit loads they travel with already light the same refresh,
 * and a request an older host never answers would only hold the light on.
 */
const ACTIVITY_LABELS: { [command: string]: keyof LocalizedStrings } = {
  loadRepos: "activityLoadingRepos",
  loadBranches: "activityLoadingBranches",
  loadCommits: "activityLoadingCommits",
  workingTreeChanges: "activityLoadingChanges",
  commitDetails: "activityLoadingCommitDetails",
  commitComparison: "activityLoadingDiff",
  fullDiffContent: "activityLoadingDiff",
  submoduleUpdate: "activityUpdatingSubmodules",
  inProgressAction: "activityRepoOperation",
  pullBranch: "activityPulling",
  pushBranch: "activityPushing",
  pushTag: "activityPushing",
  stageFiles: "activityStaging",
  unstageFiles: "activityUnstaging",
  discardFiles: "activityDiscarding",
  commitChanges: "activityCommitting",
  checkoutBranch: "activityCheckingOut",
  checkoutCommit: "activityCheckingOut",
  cherrypickCommit: "activityCherryPicking",
  mergeBranch: "activityMerging",
  mergeCommit: "activityMerging",
  rebase: "activityRebasing",
  resetToCommit: "activityResetting",
  revertCommit: "activityReverting",
  addTag: "activityUpdatingRefs",
  deleteTag: "activityUpdatingRefs",
  createBranch: "activityUpdatingRefs",
  deleteBranch: "activityUpdatingRefs",
  renameBranch: "activityUpdatingRefs",
  deleteRemoteBranch: "activityUpdatingRefs",
  addRemote: "activityUpdatingRemotes",
  renameRemote: "activityUpdatingRemotes",
  removeRemote: "activityUpdatingRemotes",
  setRemoteUrl: "activityUpdatingRemotes",
  setDefaultRemote: "activityUpdatingRemotes",
  runTool: "activityRunningTool"
};

/** The three operations `remoteOperation` covers, which its payload names. */
const REMOTE_OPERATION_LABELS: { [operation: string]: keyof LocalizedStrings } = {
  fetch: "activityFetching",
  pull: "activityPulling",
  push: "activityPushing"
};

/**
 * What to call the work a request starts, or null when the request is not
 * worth a light. `remoteOperation` is the one command whose label depends on
 * its payload rather than its name.
 */
export function requestLabel(message: RequestMessage): string | null {
  const key =
    message.command === "remoteOperation"
      ? REMOTE_OPERATION_LABELS[message.operation]
      : ACTIVITY_LABELS[message.command];
  return key === undefined ? null : l10n[key];
}

/**
 * The requests in flight, oldest first, keyed by command so the response can
 * find them. Two loads of the same kind collapse into one entry: the second
 * response cannot be told from the first, so keeping both would only leave one
 * of them stuck.
 */
export class ActivityTracker {
  private pending = new Map<string, { label: string; startedAt: number }>();

  /** Registers a request. Returns whether it was one this reports on. */
  begin(message: RequestMessage, now: number): boolean {
    const label = requestLabel(message);
    if (label === null) {
      return false;
    }
    this.pending.set(message.command, { label, startedAt: now });
    return true;
  }

  /**
   * Settles the request a response answers, and reports what it was called so
   * the idle tooltip can name the last thing that ran. Null when the response
   * answers nothing this was tracking.
   */
  settle(message: ResponseMessage): string | null {
    const entry = this.pending.get(message.command);
    if (entry === undefined) {
      return null;
    }
    this.pending.delete(message.command);
    return entry.label;
  }

  /** True while any registered request is unanswered and not yet stale. */
  busy(now: number): boolean {
    return this.labels(now).length > 0;
  }

  /**
   * Labels of the work still running, oldest first. Dropping stale entries
   * here rather than on a timer keeps the tracker free of the clock: the next
   * question asked of it is what expires them.
   */
  labels(now: number): string[] {
    const live: string[] = [];
    for (const [command, entry] of this.pending) {
      if (now - entry.startedAt >= STALE_REQUEST_MS) {
        this.pending.delete(command);
      } else if (!live.includes(entry.label)) {
        live.push(entry.label);
      }
    }
    return live;
  }

  /**
   * Milliseconds until the oldest request in flight goes stale, or null when
   * nothing is pending. Ask after `labels()`, which is what prunes the entries
   * that are already past it.
   */
  nextExpiry(now: number): number | null {
    let oldest: number | null = null;
    for (const entry of this.pending.values()) {
      if (oldest === null || entry.startedAt < oldest) {
        oldest = entry.startedAt;
      }
    }
    return oldest === null ? null : Math.max(0, STALE_REQUEST_MS - (now - oldest));
  }
}

/** The tooltip for a given set of running labels; the idle text when empty. */
export function activityTooltip(labels: string[], lastCompleted: string | null): string {
  if (labels.length > 0) {
    return labels.join("\n");
  }
  return lastCompleted === null
    ? l10n.activityReady
    : l10n.activityReadyAfter.replace("{0}", lastCompleted);
}

/** A circle with a check inside it: nothing is running. */
const IDLE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="m5.4 8.3 1.9 1.9 3.4-4"/></svg>';

/**
 * The same circle with a quarter of its rim drawn solid, spun by CSS. The ring
 * stays put so the control does not change size or weight when work starts --
 * only the arc moves.
 */
const BUSY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle class="activityStatusRing" cx="8" cy="8" r="6"/><path class="activityStatusArc" d="M8 2a6 6 0 0 1 6 6"/></svg>';

let tracker = new ActivityTracker();
let lastCompleted: string | null = null;
/** What the element is currently showing, so an unchanged state is left alone. */
let rendered: "idle" | "busy" | null = null;
/** Set while a stale-expiry check is scheduled, so only one is ever pending. */
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts watching the message channel. Call before the view sends anything;
 * responses are handed in by the view's own message handler, which already
 * owns that listener.
 */
export function initActivityIndicator() {
  tracker = new ActivityTracker();
  lastCompleted = null;
  rendered = null;
  observeMessagesSent((message) => {
    if (tracker.begin(message, Date.now())) {
      renderActivityStatus();
    }
  });
  renderActivityStatus();
}

/** Settles whatever the response answers, and repaints when it settled one. */
export function noteActivityResponse(message: ResponseMessage) {
  const settled = tracker.settle(message);
  if (settled !== null) {
    lastCompleted = settled;
    renderActivityStatus();
  }
}

/** Paints the current state into the toolbar, if the element is on the page. */
export function renderActivityStatus() {
  const element = document.getElementById("activityStatus");
  if (element === null) {
    return;
  }
  const now = Date.now();
  const labels = tracker.labels(now);
  const busy = labels.length > 0;
  const state = busy ? "busy" : "idle";
  // Only when the light actually changes colour: replacing the markup restarts
  // the arc's animation from zero, so repainting on every message would make a
  // busy light stutter once per request instead of turning evenly.
  if (state !== rendered) {
    rendered = state;
    element.classList.toggle("busy", busy);
    element.innerHTML = busy ? BUSY_ICON : IDLE_ICON;
  }
  // The text changes with every request either way, and costs nothing.
  const tooltip = activityTooltip(labels, lastCompleted);
  element.title = tooltip;
  element.setAttribute("aria-label", tooltip);
  scheduleExpiry(tracker.nextExpiry(now));
}

/**
 * Repaints when the oldest request goes stale. Without it a request that is
 * never answered leaves the light spinning until the next message, which for
 * an idle app can be never. The delay tracks that request's own deadline
 * rather than restarting at every repaint, which would push it further out
 * each time another message arrived.
 */
function scheduleExpiry(delay: number | null) {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  if (delay !== null) {
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      renderActivityStatus();
    }, delay);
  }
}
