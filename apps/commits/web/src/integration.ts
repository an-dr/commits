import type { RepositoryHealth } from "@commits/adapter/health/facts";
import type { RepositorySource, SourceRepository } from "@commits/adapter/host/host-port";
import { parseThemeFile, type SessionAppearance } from "./themes";

const post = (command: string): void => window.ipc.postMessage(JSON.stringify({ command }));

/** Stable per-source sections: favorites, alphabetical groups, then ungrouped. */
export function sourceGroups(source: RepositorySource): { name: string; repositories: SourceRepository[] }[] {
  const seen = new Set<string>();
  const repositories = source.repositories.filter((entry) => {
    const key = entry.path.replace(/\\/g, "/").replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const groups = [...new Set(repositories.filter((entry) => !entry.favorite && entry.group).map((entry) => entry.group!))].sort();
  return [
    { name: "Favorites", repositories: repositories.filter((entry) => entry.favorite) },
    ...groups.map((name) => ({ name, repositories: repositories.filter((entry) => !entry.favorite && entry.group === name) })),
    { name: "", repositories: repositories.filter((entry) => !entry.favorite && !entry.group) },
  ].filter((group) => group.repositories.length > 0);
}

/** Adds standalone integrations without coupling the shared graph to a caller. */
export function wireIntegration(appearance: { override(session: SessionAppearance): void }): void {
  let health: RepositoryHealth | null = null;
  let sources: readonly RepositorySource[] = [];
  let recent: readonly string[] = [];
  const renderSelector = (): void => {
    const menu = document.querySelector<HTMLElement>("#repoSelect .dropdownMenu");
    if (!menu || menu.querySelector("#standaloneSelector")) return;
    const selector = document.createElement("div"); selector.id = "standaloneSelector";
    menu.append(selector);
    menu.classList.add("standaloneSourcesSelector");
    populateSources(selector, sources, recent, () => document.querySelector<HTMLElement>("#repoSelect .dropdownCurrentValue")?.click());
  };
  const renderHealth = (): void => {
    const activity = document.getElementById("activityStatus");
    if (!activity || !health) return;
    let button = document.getElementById("standaloneHealth") as HTMLButtonElement | null;
    if (!button) {
      button = document.createElement("button"); button.id = "standaloneHealth"; button.type = "button";
      button.addEventListener("click", () => post("standaloneHealthNavigate"));
      activity.after(button);
    }
    const { facts, verdict } = health;
    const count = verdict.id === "conflicted" ? facts.conflicted : verdict.id === "behind" ? facts.behind : verdict.id === "dirty" ? facts.changes : verdict.id === "ahead" ? facts.ahead : 0;
    const label = `${verdict.label}${count > 0 ? ` ${count}` : ""}`;
    if (button.textContent !== label) button.textContent = label;
    button.dataset.urgency = verdict.urgency;
    button.disabled = verdict.id === "missing" || verdict.id === "not-a-repo" || verdict.id === "clean";
    button.title = verdict.id === "behind" || verdict.id === "diverged" ? "Behind counts only what the last fetch saw" : verdict.label;
  };
  const observer = new MutationObserver(() => { renderHealth(); renderSelector(); });
  observer.observe(document.getElementById("controls") ?? document.body, { childList: true, subtree: true });
  window.addEventListener("focus", () => post("standaloneFocus"));
  document.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest("#repoSelect, #standaloneMenuOpen, #standaloneMenuRecentGroup")) post("standaloneSources");
  });
  window.addEventListener("bones-message", (event) => {
    let data: Record<string, unknown>;
    try { data = JSON.parse((event as CustomEvent<string>).detail); } catch { return; }
    switch (data.command) {
      case "repoHealth": health = data as unknown as RepositoryHealth; renderHealth(); break;
      case "standaloneRecentRepositories":
      case "standaloneRepositoryRequired": recent = (data.recent ?? []) as string[]; document.getElementById("standaloneSelector")?.remove(); renderSelector(); break;
      case "standaloneSources": sources = data.sources as RepositorySource[]; renderSources(sources); document.getElementById("standaloneSelector")?.remove(); renderSelector(); break;
      case "standaloneNotice": showNotice(String(data.message)); break;
      case "standaloneSessionAppearance": {
        const session: SessionAppearance = {};
        if (data.theme === "light" || data.theme === "dark") session.mode = data.theme;
        if (typeof data.themeFileName === "string") {
          const parsed = data.themeFileError ? new Error(String(data.themeFileError)) : parseThemeFile(data.themeFile);
          if (parsed instanceof Error) { session.file = undefined; showNotice(`${data.themeFileName}: ${parsed.message}`); }
          else session.file = parsed;
        }
        appearance.override(session);
        break;
      }
      case "standaloneNavigate": {
        // The shared graph consumes its load response synchronously before this frame.
        requestAnimationFrame(() => {
          if (data.hash === null) { document.getElementById("view")?.scrollTo(0, 0); return; }
          const row = data.hash === "*" ? document.querySelector<HTMLElement>("tr.unsavedChanges")
            : Array.from(document.querySelectorAll<HTMLElement>("tr[data-hash]")).find((row) => row.dataset.hash === data.hash);
          if (!row) { showNotice(data.hash === "*" ? "No working-tree changes to select." : "Target is outside the loaded history."); return; }
          row.scrollIntoView({ block: "center" });
          row.querySelector<HTMLElement>(".description")?.click();
        });
        break;
      }
    }
  });
}

function showNotice(message: string): void {
  let notice = document.getElementById("standaloneNotice");
  if (!notice) { notice = document.createElement("div"); notice.id = "standaloneNotice"; notice.setAttribute("role", "status"); document.body.append(notice); }
  notice.textContent = message;
  notice.title = message;
}

function renderSources(sources: readonly RepositorySource[]): void {
  let container = document.getElementById("standaloneSources");
  const recent = document.getElementById("standaloneRecentRepos");
  if (!recent) return;
  if (!container) { container = document.createElement("div"); container.id = "standaloneSources"; recent.after(container); }
  populateSources(container, sources);
}

function populateSources(container: HTMLElement, sources: readonly RepositorySource[], recent: readonly string[] = [], close = (): void => {}): void {
  container.replaceChildren();
  if (recent.length > 0) {
    const heading = document.createElement("h2"); heading.textContent = "Recent"; container.append(heading);
    for (const path of recent) {
      const button = document.createElement("button"); button.type = "button"; button.className = "standaloneSourceRepo"; button.textContent = path;
      button.addEventListener("click", () => { close(); window.ipc.postMessage(JSON.stringify({ command: "standaloneOpenRepository", path })); });
      container.append(button);
    }
  }
  for (const source of sources) {
    const heading = document.createElement("h2"); heading.textContent = source.name; container.append(heading);
    for (const group of sourceGroups(source)) {
      if (group.name) { const heading = document.createElement("h3"); heading.textContent = group.name; container.append(heading); }
      for (const repository of group.repositories) {
        const button = document.createElement("button"); button.type = "button"; button.className = "standaloneSourceRepo";
        const name = document.createElement("span"); name.textContent = repository.name;
        const path = document.createElement("small"); path.textContent = repository.path;
        button.append(name, path); button.disabled = !repository.available; button.title = repository.path;
        button.addEventListener("click", () => { close(); window.ipc.postMessage(JSON.stringify({ command: "standaloneOpenRepository", path: repository.path })); });
        container.append(button);
      }
    }
  }
}
