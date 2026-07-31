/** Returns up to two stable initials for an author, using the email as a fallback. */
export function getCommittedAuthorInitials(author: string, email: string) {
  const source = (author.trim() !== "" ? author : email).trim();
  if (source === "") {
    return "??";
  }

  const parts = source.match(/[0-9A-Za-z]+/g) || [];
  let initials: string;
  if (parts.length >= 2) {
    initials = parts[0]!.charAt(0) + parts[1]!.charAt(0);
  } else if (parts.length === 1) {
    initials = parts[0]!.slice(0, 2);
  } else {
    initials = source.replace(/\s+/g, "").slice(0, 2);
  }

  initials = initials.toUpperCase();
  if (initials.length === 1) {
    initials += initials;
  }
  return initials.length > 0 ? initials : "??";
}

/** Returns the stable initials-badge colour derived from an author seed. */
export function getCommittedInitialsBackgroundColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return "hsl(" + hue + ", 46%, 36%)";
}
