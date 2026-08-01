import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const script = await readFile(new URL("dist/ui/page.js", root), "utf8");
const css = await readFile(new URL("dist/ui/page.css", root), "utf8");
const template = await readFile(new URL("apps/commits/web/src/index.html", root), "utf8");
const html = template
  .replace("/*__COMMITS_CSS__*/", css)
  .replace("/*__COMMITS_JS__*/", script);
const previewIpc = `
window.ipc = { postMessage(json) {
  const request = JSON.parse(json);
  const send = response => queueMicrotask(() => window.dispatchEvent(
    new CustomEvent("bones-message", { detail: JSON.stringify(response) })
  ));
  if (request.command === "standaloneReady" || request.command === "loadRepos") {
    send({ command: "loadRepos", repos: { "C:/00_Code/commits": { columnWidths: null } }, lastActiveRepo: "C:/00_Code/commits" });
  } else if (request.command === "loadBranches") {
    send({ command: "loadBranches", branches: ["codex/phase-2-3", "docs/roadmap", "main", "remotes/origin/codex/phase-2-3", "remotes/origin/main"], head: "codex/phase-2-3", hard: request.hard, isRepo: true });
  } else if (request.command === "loadCommits") {
    send({ command: "loadCommits", head: "3e8588ac", moreCommitsAvailable: false, hard: request.hard, commits: [
      { hash: "*", parentHashes: ["3e8588ac"], author: "*", email: "", date: 1785535320, message: "Uncommitted Changes (78)", refs: [] },
      { hash: "3e8588ac", parentHashes: ["1d1b265b"], author: "Andrei Gramakov", email: "", date: 1785535140, message: "wip", refs: [{ hash: "3e8588ac", name: "codex/phase-2-3", type: "head" }, { hash: "3e8588ac", name: "origin/codex/phase-2-3", type: "remote" }] },
      { hash: "1d1b265b", parentHashes: ["2c7ff138"], author: "Andrei Gramakov", email: "", date: 1785273840, message: "test: cover credential prompt subscription", refs: [] },
      { hash: "2c7ff138", parentHashes: ["f22ff8ec"], author: "Andrei Gramakov", email: "", date: 1785273780, message: "chore: record credential bridge verification", refs: [] },
      { hash: "f22ff8ec", parentHashes: ["d48b77d0"], author: "Andrei Gramakov", email: "", date: 1785273720, message: "feat: bridge credential prompts to the page", refs: [] },
      { hash: "d48b77d0", parentHashes: ["7444c4cb"], author: "Andrei Gramakov", email: "", date: 1785273660, message: "chore: record phase 4 verification", refs: [] },
      { hash: "7444c4cb", parentHashes: [], author: "Andrei Gramakov", email: "", date: 1785273600, message: "docs: record phase 4 read surface evidence", refs: [{ hash: "7444c4cb", name: "main", type: "head" }] }
    ] });
  } else if (request.command === "repoInProgress") {
    send({ command: "repoInProgress", state: null });
  }
} };`;
const preview = template
  .replace("/*__COMMITS_CSS__*/", css)
  .replace("/*__COMMITS_JS__*/", `${previewIpc}\n${script}`);
// The page is emitted as a file the host serves at run time, so rebuilding it
// never requires rebuilding the WebAssembly component.
await mkdir(new URL("dist/ui/", root), { recursive: true });
await writeFile(new URL("dist/ui/preview.html", root), preview);
await writeFile(new URL("dist/ui/page.html", root), html);
