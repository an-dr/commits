export const refInvalid = /^[-/].*|[\\" ><~^:?*[]|\.\.|\/\/|\/\.|@{|[./]$|\.lock$|^@$/g;
export const ELLIPSIS = "&#8230;";

/** Shortens a commit hash to the length the view shows it at. */
export function abbrevCommit(commitHash: string) {
  return commitHash.substring(0, 8);
}

export function arraysEqual<T>(a: T[], b: T[], equalElements: (a: T, b: T) => boolean) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!equalElements(a[i], b[i])) {
      return false;
    }
  }
  return true;
}
