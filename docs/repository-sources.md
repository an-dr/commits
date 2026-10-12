# Repository sources

Any caller can offer repositories to Commits by writing a source file. Commits reads the files and never modifies them.

## Location and format

One `<source-id>.json` file per source lives in `~/.commits/sources/` (`%USERPROFILE%\.commits\sources\` on Windows). Source ids contain lowercase letters, digits and hyphens. `COMMITS_SOURCES_DIR` overrides the directory. Writers create a temporary file in the same directory and rename it over their own file. Removing a source means deleting its file.

```json
{
  "version": 1,
  "name": "Workspace",
  "repositories": [
    { "name": "bones", "path": "C:\\Code\\bones", "group": "engine", "favorite": true }
  ]
}
```

`version` is integer 1; higher versions are skipped. `name` is the section heading. Each repository has a string `name` and an absolute, expanded `path`; optional `group` is a string and optional `favorite` is a boolean, defaulting to false. Unknown fields are ignored.

## Selector behavior

Recent appears first, then sources in filename order. Within each source, favorites appear first, followed by groups alphabetically, then ungrouped entries. Entries show their names and paths; missing directories are unavailable and cannot be opened. Duplicates appear once per section. Opening an entry follows the same repository-opening path as Recent.

Commits refreshes when the selector opens and when the window regains focus. Missing folders and deleted files contribute no section. A malformed or mid-write file retains its last successfully parsed source; a file without a previous good parse contributes nothing. An unsupported version removes its section until a supported file returns.
