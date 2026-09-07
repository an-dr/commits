# Linux startup and responsiveness investigation

Working notes for the `bugfix/linux-webview-crash` branch. Seven separate
faults presented as one "the app is broken on Linux" report; each is recorded
here with the evidence that identified it, because the first explanation
reached was wrong twice.

## 1. White window for a minute after launch — fixed

**Symptom.** The window stayed solid white for up to a minute, with
`commits.log` already showing `commits graph panel opened` within a second.

**First explanation, wrong.** The compositor. `journalctl` showed
`cosmic-comp` failing to import the NVIDIA driver's buffer format during the
same window, and the README documented that as the cause.

**Actual cause.** The page server in
[`apps/commits/host/src/page.rs`](../apps/commits/host/src/page.rs) answered
connections one at a time on a single thread with no read timeout. WebKit
opens a spare socket it never sends a request on; that socket was accepted
first, the reader blocked on it, and the real `GET /page.html` sat unread in
the kernel receive buffer until WebKit's own idle timeout closed the spare
socket a minute later.

**Evidence.** `ss -tnp` during the white window:

```text
ESTAB  Recv-Q 0    127.0.0.1:45669 <-> :38898  commits-app fd=50   accepted, silent
ESTAB  Recv-Q 430  127.0.0.1:45669 <-> :38912  (no reader)         GET /page.html, unread
```

Both disappeared at t≈60s, and the page painted immediately after.

**Fix.** A thread per connection plus a read timeout, with a regression test
that opens a silent connection first and asserts the next request is still
answered at once.

## 2. No mouse cursor over the window — not this app

**Symptom.** The pointer vanished over the window's content while staying
visible over its borders.

**Cause.** An X pointer grab held by another client with a blank cursor. A
grab's cursor applies to the whole X screen, so every Xwayland client's
content lost the pointer; the borders are drawn by the compositor, which is
why they kept theirs.

**Evidence.** `xterm` — a plain X11 client with none of this app's code —
reproduced it exactly. `XFixesGetCursorImage` returned the same 1x1 fully
transparent cursor (serial 51) at every screen position, and `XGrabPointer`
returned `AlreadyGrabbed`. The holder was a game running under Proton, which
owns a fullscreen `InputOnly` clipping window. Quitting it restored the
cursor.

**Fix.** None here, and none possible: no application can draw over another
client's grab cursor. The app is exposed to it because wry's child-webview
embedding is X11-only, so the window is an Xwayland client.

## 3. Unresponsive window, graph stuck "Loading" — fixed

**Symptom.** Opening `vendor/bones` left the graph on "Loading …" forever, and
nothing else in the interface reacted — no error anywhere.

**Actual cause.** A self-sustaining refresh loop. `git status` in a repository
that has submodules takes `index.lock` inside each submodule's Git directory
even when it writes nothing. The watcher
([`crates/watcher`](../crates/watcher)) watches the Git directory recursively
and treated any change there as a repository change, so:

```text
refresh -> git status -> submodule index.lock -> "repository changed" -> refresh
```

The cycle ran every ~450ms, nine Git commands at a time, forever. The
interface never left its loading state, and user actions competed with the
storm.

**Evidence.** Bus recording from the control channel (see below):

```text
85185ms  git/completed   git      [33365 bytes] ...           the graph data arrives
85470ms  repo/full-refresh watcher .git/modules/vendor/bones/index.lock
85503ms  web/page-message web      {"command":"repoInProgress"}
85521ms  git/request     commits  for-each-ref ...            and around again
```

`vendor/bones` triggers it and the outer repository does not, because
`vendor/bones` contains a submodule of its own (`vendor/pubsub-bus`): a
before/after `find -printf %T@` around each command in the cycle showed
`git status` touching only the nested submodule's Git directory.

**Fix.** The watcher ignores `*.lock` inside the metadata roots. Git writes
`<file>.lock` and renames it over `<file>`, so the lock says nothing the
guarded file will not say a moment later. The filter is scoped to the Git
directory, since a working tree's `Cargo.lock` is an ordinary edit.

**Verification.** Same repository, driven the same way: zero
`repo/full-refresh` events, nine Git commands total, and the graph rendered.

## 4. Push did nothing and said nothing — fixed

**Symptom.** Pressing push produced no reaction and no error.

**Cause, in two parts.** Once the refresh loop was gone, `git push` did run --
and then blocked on a credential prompt nobody ever saw. `commits-askpass`
writes its question for the OS module, which publishes it as `os/prompt`; the
adapter forwards it to the page as `standaloneCredentialPrompt`; and the page
had no handler for that message. Git waited the full two minutes askpass
allows, then failed. The OS module also republished the unanswered prompt
every frame -- sixty identical messages a second for those two minutes.

**Evidence.** Driving a push through the control channel, with the graph
already loaded:

```text
128882ms  git: #40000 run: git push (in .../vendor/bones)
130682ms  os/prompt  os  askpass  Username for 'https://github.com':
130698ms  os/prompt  os  askpass  Username for 'https://github.com':
   ... the same line every 17ms, and no dialog on screen
```

**Fix.** The page now shows the prompt and answers it (`credentialResponse`),
the adapter passes that answer to the waiting helper, and the OS module
announces each prompt once, forgetting it when the request file goes away.
Cancelling answers with nothing on purpose: Git then fails immediately with
its own authentication error instead of hanging until the timeout.

## 5. The chooser busy loop — fixed

With nothing open, the page cycled `loadRepos` → `selectRepo` (with no repo)
→ `loadBranches` about twenty times a second for as long as the chooser was on
screen. `loadRepos` with an empty set fell through to "change to
`repoPaths[0]`" -- `undefined` -- and refreshed; the refresh's branch load
answered `isRepo: false`, whose documented response is to ask for the
repository list again. An empty list makes that a loop. The view now returns
early when the set is empty.

## 6. A slot the runner never got back — fixed before it was reported

Found while verifying the push fix, not from a report. The Git runner allows
four commands at a time and read each command's output to end of file. That is
immediate when the command closes its own pipes, and never when something it
started still holds them -- which is exactly what `commits-askpass` does while
it waits its two minutes for an answer. Killing Git does not shorten it: the
helper is a separate process. Four prompted pushes would therefore have left
the app unable to run any Git command at all, with no error to show for it.

Output is now collected with a two-second grace after the command itself ends.
A straggler holding the pipe is not producing Git's answer, so it is not worth
a slot. The regression test backgrounds a process that holds stdout for thirty
seconds and asserts the runner returns anyway.

## 7. The engine froze while a repository was opened — fixed

Also found by verification rather than reported, and the last piece of "the
app is unresponsive". Opening a repository left a gap of 3 to 18 seconds
between the repository scan's result and anything happening with it. The
guest was not the cause: a probe at the top of its handler showed it receiving
the message 2ms after it was published and finishing in 2ms.

The tick heartbeat is what identified it. With one frame tick per second kept
in the recording, the gap contains none at all:

```text
  8046ms  repo-os/result  repo-os  .../vendor/bones
     (no ticks -- the engine is not turning)
 13199ms  watcher/request commits  .../vendor/bones
```

The engine's own loop had stopped, inside `WatcherModule::start`. `notify`
adds one inotify watch per directory, so a recursive watch walks the whole
tree -- logged at 1.7 to 2.5 seconds for `vendor/bones` warm, longer cold, and
it grows with the repository. Registration now runs on its own thread and the
watcher is installed when it is ready; a stop that arrives first makes the
thread drop it instead. The same open now takes 17ms from result to the work
that follows, with the tree still being registered in the background.

## Follow-up worth considering

Registration is off the engine's thread, but it is still slow: 19.9 seconds
for this repository, measured by the watcher's own log. The reason is that
`notify`'s recursive mode watches everything, including the directories the
event filter then throws away:

```text
total directories                              5921
excluding target/node_modules/dist/.tools      834
```

Walking the tree here, pruning those, and watching each surviving directory
non-recursively would cut it by roughly seven times, and stop spending inotify
descriptors on build output. It was left undone deliberately: a non-recursive
watch does not cover directories created later, so it needs a watch added when
a new directory appears, and getting that wrong loses events silently. Worth
doing with the user awake to weigh it, not unattended. Nothing is broken as it
stands -- the cost is background work now, not a frozen window.

## Tools built along the way

**The control channel**
([`apps/commits/host/src/control.rs`](../apps/commits/host/src/control.rs)).
The interface is a webview, and a webview under Xwayland cannot be clicked by
synthetic X input — `XTestFakeButtonEvent` moves the pointer the compositor
draws, not the one the Wayland surface receives, which was verified by
clicking a focusable field and observing no change. Everything the interface
does is a JSON message, so the channel posts those messages directly and
records the whole bus. It is off unless `COMMITS_CONTROL_PORT` is set:

```bash
COMMITS_CONTROL_PORT=8642 ./commits
curl -s -X POST --data-binary '{"command":"standaloneOpenRepository","path":"/repo"}' \
     'localhost:8642/page-message?owner=commits&panel=main'
curl -s 'localhost:8642/messages?topic=git/&limit=20'
```

**Timing logs.** The watcher records how long registering a tree took, and
the control channel keeps one frame tick per second: a stall with no
heartbeats in it is the engine itself, and one with heartbeats is a module.

**Git logging.** [`crates/git`](../crates/git) logged nothing at all, which is
why a command that never ran and a command that failed looked identical from
outside. Every command now records its arguments and its exit, failures at
error level with the reason Git gave.

## Review corrections

The GTK backend selects X11 without changing the environment after worker threads start. Launch with `SDL_VIDEO_DRIVER=x11 GDK_BACKEND=x11` when the session defaults to Wayland; an X server or Xwayland must be available. An existing GTK initialization must belong to the runner thread and use X11.

Git output already received is retained when a helper outlives Git and keeps its pipes open.

Watch registration and cancellation acquire their shared locks in the same order.

Concurrent credential questions are queued, and answering clears the input before showing the next question.

The optional control channel accepts local tool requests, rejects browser-originated requests and non-loopback Host headers, and requires a complete bounded request body. Credential responses are redacted from its history. This channel remains opt-in through `COMMITS_CONTROL_PORT`.
