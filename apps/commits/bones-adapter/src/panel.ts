/**
 * The one web panel this component owns. Bones names a panel by owner and
 * panel name together, and the component both opens it under these names and
 * filters panel events by them, so they live in one place.
 */
export const PANEL_OWNER = "commits";
export const PANEL_NAME = "main";

/** Whether a web event addresses this component's panel. */
export function isOwnPanel(event: { readonly owner: string; readonly panel: string }): boolean {
  return event.owner === PANEL_OWNER && event.panel === PANEL_NAME;
}
