/**
 * Resolves a file's icon markup from the map `loadFileIcons` sends once at
 * load, matching the exact filename first (dotfiles, package manifests),
 * then the lowercased extension. Returns null when nothing matches, so the
 * caller can fall back to the one generic file icon.
 */
export function resolveFileIcon(icons: Record<string, string>, filename: string): string | null {
  if (icons[filename]) {
    return icons[filename];
  }
  const dot = filename.lastIndexOf(".");
  if (dot > 0) {
    const ext = filename.slice(dot + 1).toLowerCase();
    if (icons[ext]) {
      return icons[ext];
    }
  }
  return icons[""] || null;
}
