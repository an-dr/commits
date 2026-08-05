# Phase 4: standalone graphical read surface

The bones page now provides a local, read-only history surface:

- repository path entry and native folder picker;
- refreshable real Git snapshots from the Phase 3 core;
- branch/tag/remote reference panel, graph lane, and commit table;
- commit metadata and parent tree detail panel;
- Ctrl/Cmd+F filtering and a copy-hash context action;
- standalone light/dark palettes supplied through the VS Code CSS variables
  consumed by the shared MIT webview.

The compact graph deliberately renders one lane in this iteration. Merge
parents remain visible in the selected-commit tree. Remote mutation, diff
contents, editor integration, and VS Code-only commands are intentionally
excluded from this read-only standalone surface.

Verification: optimized JS/CSS build, TypeScript tests, current-repository Git
snapshot test, and the complete native/component test suite.
