# Commits — repository-specific agent notes

## Bump the app version on every integration

`apps/commits/host/Cargo.toml`'s `[package] version` is the standalone app's
own version. It is baked in at compile time (`CARGO_PKG_VERSION`), compared
against a hosted manifest by the self-updater
(`commits_upgrader::is_newer`, see [`docs/updating.md`](docs/updating.md)),
and shown in the app's About menu.

Bump it as part of every integration into `main` that changes user-facing
behavior. An integration that doesn't bump it means the running app can
never tell a later release apart from itself, so `check` will keep
reporting "up to date" no matter what actually shipped.
