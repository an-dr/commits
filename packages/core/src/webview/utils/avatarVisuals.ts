import { getCommittedAuthorInitials, getCommittedInitialsBackgroundColor } from "./committedColumn";
import { escapeHtml } from "./html";

export type AvatarConfig = {
  committedVisual: "Avatar" | "Initials";
  avatarMode: "Auto (Fetched then Pattern)" | "Fetched Only" | "Procedural Pattern" | "Disabled";
  avatarSize: "Normal" | "Small";
  avatarShape: "Circle" | "Square";
  fetchAvatars: boolean;
};

export type AuthorVisual = {
  image: string | null;
  procedural: boolean;
  updateOnFetch: boolean;
};

const proceduralAvatars: { [seed: string]: string } = {};

function getAuthorAvatarSeed(author: string, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== "") {
    return "email:" + normalizedEmail;
  }
  const normalizedAuthor = author.trim().toLowerCase();
  return normalizedAuthor !== "" ? "author:" + normalizedAuthor : "author:unknown";
}

function getProceduralAvatarImage(seed: string) {
  if (typeof proceduralAvatars[seed] === "string") {
    return proceduralAvatars[seed];
  }
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0 || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const size = 40,
    grid = 5,
    cellSize = 8,
    radius = 1;
  const hue = Math.floor(next() * 360);
  const background = "hsl(" + hue + ", 38%, 20%)";
  const colours = [
    "hsl(" + ((hue + 24) % 360) + ", 68%, 58%)",
    "hsl(" + ((hue + 160) % 360) + ", 68%, 55%)",
    "hsl(" + ((hue + 290) % 360) + ", 64%, 61%)"
  ];
  let cells = "";
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < Math.ceil(grid / 2); x++) {
      if (next() >= 0.42) {
        const fill = colours[Math.floor(next() * colours.length)];
        const leftX = x * cellSize,
          rightX = (grid - 1 - x) * cellSize,
          topY = y * cellSize;
        cells +=
          '<rect x="' +
          leftX +
          '" y="' +
          topY +
          '" width="' +
          cellSize +
          '" height="' +
          cellSize +
          '" rx="' +
          radius +
          '" ry="' +
          radius +
          '" fill="' +
          fill +
          '" />';
        if (rightX !== leftX) {
          cells +=
            '<rect x="' +
            rightX +
            '" y="' +
            topY +
            '" width="' +
            cellSize +
            '" height="' +
            cellSize +
            '" rx="' +
            radius +
            '" ry="' +
            radius +
            '" fill="' +
            fill +
            '" />';
        }
      }
    }
  }
  if (next() > 0.5) {
    const stripe = colours[Math.floor(next() * colours.length)];
    cells +=
      '<path d="M0 0 L' + size + " 0 L0 " + size + ' Z" fill="' + stripe + '" opacity="0.18" />';
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    size +
    " " +
    size +
    '"><rect x="0" y="0" width="' +
    size +
    '" height="' +
    size +
    '" fill="' +
    background +
    '" />' +
    cells +
    "</svg>";
  const image = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  proceduralAvatars[seed] = image;
  return image;
}

function getAuthorAvatarShapeClass(config: AvatarConfig) {
  return config.avatarShape === "Square" ? "square" : "circle";
}

function getAuthorAvatarSizeClass(config: AvatarConfig) {
  return config.avatarSize === "Small" ? "small" : "normal";
}

/** Chooses the fetched, procedural, or absent visual for one commit author. */
export function getAuthorVisual(
  config: AvatarConfig,
  author: string,
  email: string,
  fetchedAvatar: string | null
): AuthorVisual {
  const mode = config.avatarMode;
  if (mode === "Disabled") {
    return { image: null, procedural: false, updateOnFetch: false };
  }

  const canFetchByEmail = email !== "" && config.fetchAvatars;
  if (mode === "Procedural Pattern") {
    return {
      image: getProceduralAvatarImage(getAuthorAvatarSeed(author, email)),
      procedural: true,
      updateOnFetch: false
    };
  }
  if (mode === "Fetched Only") {
    return {
      image: canFetchByEmail ? fetchedAvatar : null,
      procedural: false,
      updateOnFetch: canFetchByEmail
    };
  }
  if (fetchedAvatar !== null) {
    return { image: fetchedAvatar, procedural: false, updateOnFetch: canFetchByEmail };
  }
  return {
    image: getProceduralAvatarImage(getAuthorAvatarSeed(author, email)),
    procedural: true,
    updateOnFetch: canFetchByEmail
  };
}

/** Renders the configured author avatar or initials badge for a commit row. */
export function renderAuthorVisualHtml(
  config: AvatarConfig,
  author: string,
  email: string,
  fetchedAvatar: string | null
): string {
  const shapeClass = getAuthorAvatarShapeClass(config);
  const sizeClass = getAuthorAvatarSizeClass(config);
  if (config.committedVisual === "Initials") {
    const initials = getCommittedAuthorInitials(author, email);
    const background = getCommittedInitialsBackgroundColor(getAuthorAvatarSeed(author, email));
    return (
      '<span class="avatar initials ' +
      shapeClass +
      " " +
      sizeClass +
      '" style="background-color:' +
      background +
      ';" title="' +
      escapeHtml(author) +
      '">' +
      escapeHtml(initials) +
      "</span>"
    );
  }

  const visual = getAuthorVisual(config, author, email, fetchedAvatar);
  if (visual.image === null) {
    return visual.updateOnFetch
      ? '<span class="avatar ' +
          shapeClass +
          " " +
          sizeClass +
          ' empty" data-email="' +
          escapeHtml(email) +
          '"></span>'
      : "";
  }
  let attributes = "";
  if (visual.updateOnFetch) {
    attributes += ' data-email="' + escapeHtml(email) + '"';
  }
  if (visual.procedural) {
    attributes += ' data-procedural="true"';
  }
  return (
    '<span class="avatar ' +
    shapeClass +
    " " +
    sizeClass +
    '"' +
    attributes +
    '><img class="avatarImg" src="' +
    visual.image +
    '"></span>'
  );
}
