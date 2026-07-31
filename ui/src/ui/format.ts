import { abbrevCommit } from "../../../packages/core/src/backend/utils/string";

/** Small display helpers deliberately kept independent of the DOM. */
export function shortHash(hash: string): string { return abbrevCommit(hash); }

export function relativeDate(epochSeconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000) - epochSeconds);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
