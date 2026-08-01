import type { RepositorySnapshotResponse } from "@commits/adapter/protocol";
import { relativeDate, shortHash } from "./format";

export class RepositoryView {
  private snapshot: RepositorySnapshotResponse | null = null;
  constructor(
    private readonly branches: HTMLElement,
    private readonly commits: HTMLOListElement,
    private readonly count: HTMLElement,
    private readonly errors: HTMLElement,
    private readonly detail: HTMLElement,
    private readonly find: HTMLInputElement,
  ) { this.find.addEventListener("input", () => this.renderRows()); }

  render(snapshot: RepositorySnapshotResponse): void {
    this.snapshot = snapshot;
    this.branches.replaceChildren();
    this.commits.replaceChildren();
    this.count.textContent = String(snapshot.commits.length);
    this.errors.hidden = snapshot.errors.length === 0;
    this.errors.textContent = snapshot.errors.join(" · ");
    this.renderRefs("Branches", snapshot.refs.branches.map((ref) => ref.name), snapshot.refs.head);
    this.renderRefs("Tags", snapshot.refs.tags.map((ref) => ref.name));
    this.renderRefs("Remotes", snapshot.refs.remotes.map((ref) => ref.name));
    this.renderRows();
  }

  private renderRows(): void {
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    this.commits.replaceChildren();
    const needle = this.find.value.trim().toLocaleLowerCase();
    for (const commit of snapshot.commits.filter((candidate) => !needle || `${candidate.subject} ${candidate.author} ${candidate.hash}`.toLocaleLowerCase().includes(needle))) {
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
      row.addEventListener("click", () => this.select(commit));
      row.addEventListener("contextmenu", (event) => { event.preventDefault(); void navigator.clipboard?.writeText(commit.hash); });
      this.commits.append(row);
    }
    if (snapshot.commits.length === 0 && snapshot.errors.length === 0) {
      this.commits.append(empty("No commits matched this repository."));
    }
  }

  private select(commit: RepositorySnapshotResponse["commits"][number]): void {
    this.detail.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = commit.subject || "(no subject)";
    const meta = document.createElement("p");
    meta.className = "commit-meta";
    meta.textContent = `${commit.author} <${commit.email}> · ${commit.hash}`;
    const tree = document.createElement("ul");
    tree.className = "parent-tree";
    for (const parent of commit.parents) { const item = document.createElement("li"); item.textContent = `parent ${shortHash(parent)}`; tree.append(item); }
    if (commit.parents.length === 0) { const item = document.createElement("li"); item.textContent = "root commit"; tree.append(item); }
    this.detail.append(title, meta, tree);
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
