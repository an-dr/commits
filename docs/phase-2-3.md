# Phases 2–3: standalone native Git and read backend

## Implemented

- Fixed-layout Rust/TypeScript request codecs for Git, watching, and OS work.
- Bounded, cancellable, concurrency-limited native Git runner with correlated
  `git/completed` replies; the component only schedules work.
- Repository metadata watcher, clipboard/URL/picker capabilities, and
  askpass/editor helper executables using a private rendezvous directory.
- Host-neutral repository discovery, bounded log/ref parsers, graph cache,
  versioned settings, and restart-safe UI state.
- A correlated read backend that requests log, refs, and HEAD independently,
  ignores superseded refresh results, then sends a serializable repository
  snapshot to the page.

## Safety boundaries

- Git output is capped before parsing in the component; settings cap reads at
  2,000 commits and default to 250.
- External URLs are restricted to `http`, `https`, and `mailto`.
- The persistence file is component-scoped by bones. Product data is UTF-8
  JSON, with missing or invalid documents falling back to safe defaults.
- No source code or assets from the reference VS Code extension are shipped.

## Evidence

`core/src/read/read-backend.integration.test.ts` invokes the repository's real
Git executable after the component has already scheduled the three independent
requests. Its snapshot is JSON-smoke-tested against the current checkout.
This is paired with native cancellation, process-failure, watcher-touch,
protocol, persistence, and bounded-parser tests in their respective modules.

Run the complete verification suite with:

```powershell
npm run verify
npm audit --omit=dev
```
