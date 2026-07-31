/**
 * Constrains a value to an inclusive range.
 * @param value The value to clamp.
 * @param min The lowest allowed value.
 * @param max The highest allowed value.
 * @returns `value`, or the nearer bound when it falls outside `[min, max]`.
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
