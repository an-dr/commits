/**
 * Registers a capture-phase click listener and reports whether each click is
 * inside the caller's root element or elements.
 */
export function addOutsideClickListener(
  isInside: (target: HTMLElement) => boolean,
  onClick: (event: MouseEvent, inside: boolean) => void
): () => void {
  const listener = (event: MouseEvent) => {
    if (!event.target) {
      return;
    }
    onClick(event, isInside(event.target as HTMLElement));
  };
  document.addEventListener("click", listener, true);
  return () => document.removeEventListener("click", listener, true);
}
