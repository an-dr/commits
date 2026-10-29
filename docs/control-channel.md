# Control channel

Commits includes bones' devtools channel: a local HTTP port for driving and inspecting a running app from outside it. It exists for end-to-end checks, debugging, and agents verifying a change against the real app. The [bones devtools README](../vendor/bones/crates/bones-kernel/bones-module-devtools/README.md) is the reference for every route and its security model.

## Opening it

The channel is off unless `COMMITS_CONTROL_PORT` holds a port number when the app starts. Nothing Commits ships sets it.

```powershell
$env:COMMITS_CONTROL_PORT = 8643
.\dist\app\commits.exe
```

```sh
COMMITS_CONTROL_PORT=8643 ./dist/app/commits
```

It listens on `127.0.0.1` only and has no authentication: any local process can act as the user while it is open. Do not set the variable in a shortcut, a service, or a shell profile.

## What Commits adds

- **Logs.** `/logs` serves the same lines as `commits.log`, because the app's logger is copied into the channel's history before any module starts.
- **Component reload.** With the channel open, `devtools` is the extension controller, so `POST /extensions/reload?name=commits` reloads the component without restarting the app. Without the port, runtime extension control stays off. The reloaded component runs its `init` again and asks to open the main panel, which still exists, so the log shows `panel already exists`; treat a reload as a quick check that the new build loads, and restart the app to use it.
- **Redaction.** `os/prompt-response`, `repo-os/request`, and `web/page-message` are recorded by topic, sender, and length only, since their payloads can carry credentials or repository content.

## Useful routes

| Route | Use in Commits |
| --- | --- |
| `GET /messages?topic=git/&limit=20` | The git requests and results behind what the page shows |
| `GET /logs?level=warn` | Warnings, including malformed payloads, misspelled topics, and component timeouts |
| `GET /extensions` | Whether the `commits` component is loaded or faulted |
| `POST /page-message?owner=commits&panel=main` | Send a page command, such as `{"command":"refresh"}`, as if the page sent it |
| `POST /exit` | Close the app in order |

The canvas routes (`/frame`, `/screenshot`, `/pause`, `/step`) have nothing to show: Commits draws its interface in web panels, not with the bones renderer.

For agent access through MCP, see [Debugging with an agent](../CONTRIBUTING.md#debugging-with-an-agent).
