import type { LaunchOptions } from "@commits/ipc/native";

export type NavigationTarget = Pick<LaunchOptions, "show" | "branch" | "commit">;
export interface NavigationPort {
  selectWorkingTree(): void;
  selectGraph(): void;
  selectRevision(revision: string, isBranch: boolean): void;
}
/** One navigation entry point for launch requests and the repository-health line. */
export function applyNavigation(target: NavigationTarget, port: NavigationPort): void {
  if (target.commit) port.selectRevision(target.commit, false);
  else if (target.branch) port.selectRevision(target.branch, true);
  else if (target.show === "changes" || target.show === "conflicts") port.selectWorkingTree();
  else if (target.show === "graph") port.selectGraph();
}
