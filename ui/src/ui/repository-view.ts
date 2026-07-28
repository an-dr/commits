import type { RepositorySnapshotResponse } from "../../../core/src/protocol";
import { relativeDate, shortHash } from "./format";

export class RepositoryView {
  constructor(
    private readonly branches: HTMLElement,
    private readonly commits: HTMLOListElement,
    private readonly count: HTMLElement,
    private readonly errors: HTMLElement,
  ) {}

  render(snapshot: RepositorySnapshotResponse): void {
    this.branches.replaceChildren();
    this.commits.replaceChildren();
    this.count.textContent = String(snapshot.commits.length);
    this.errors.hidden = snapshot.errors.length === 0;
    this.errors.textContent = snapshot.errors.join(" · ");
    this.renderRefs("Branches", snapshot.refs.branches.map((ref) => ref.name), snapshot.refs.head);
    this.renderRefs("Tags", snapshot.refs.tags.map((ref) => ref.name));
    this.renderRefs("Remotes", snapshot.refs.remotes.map((ref) => ref.name));
    for (const commit of snapshot.commits) {
      const row = document.createElement("li");
      row.className = "commit-row";
      row.dataset.hash = commit.hash;
      const graph = document.createElement("span");
      graph.className = "graph-node";
      graph.setAttribute("aria-hidden", "true");
      const subject = document.createElement("strong");
      subject.textContent = commit.subject || "(no subject)";
      const meta = document.createElement("span");
      meta.className = "commit-meta";
      meta.textContent = `${shortHash(commit.hash)} · ${commit.author} · ${relativeDate(commit.date)}`;
      row.append(graph, subject, meta);
      this.commits.append(row);
    }
    if (snapshot.commits.length === 0 && snapshot.errors.length === 0) {
      this.commits.append(empty("No commits matched this repository."));
    }
  }

  private renderRefs(title: string, names: readonly string[], active?: string | null): void {
    if (names.length === 0) return;
    const heading = document.createElement("h3");
    heading.textContent = title;
    this.branches.append(heading);
    for (const name of names) {
      const item = document.createElement("p");
      item.className = name === active ? "ref active" : "ref";
      item.textContent = name;
      this.branches.append(item);
    }
  }
}

function empty(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = text;
  return item;
}
