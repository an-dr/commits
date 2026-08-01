/**
 * Resolves the next branch selection.
 *
 * "Show All" is exclusive because combining it with a branch would be
 * meaningless, and removing the last entry falls back to it rather than
 * leaving nothing selected.
 */
export function nextBranchSelection(
  current: readonly string[],
  value: string,
  additive: boolean
): string[] {
  if (!additive || value === "") {
    return [value];
  }
  const withoutShowAll = current.filter((branch) => branch !== "");
  if (withoutShowAll.indexOf(value) > -1) {
    const remaining = withoutShowAll.filter((branch) => branch !== value);
    return remaining.length > 0 ? remaining : [""];
  }
  return [...withoutShowAll, value];
}
