# Theme contract

The webview stylesheet reads these CSS custom properties from the document
root. A host that is not VS Code must define them, or the view renders with the
browser defaults.

They keep their `--vscode-` prefix deliberately: renaming them would be a large
mechanical change to `media/main.css` for no behavioural gain, and the names
document which editor concept each colour came from.

`--git-graph-color` is set per row by the view itself from the configured
palette, and is not a host responsibility.

## Properties the host supplies

| Property                                            |
| --------------------------------------------------- |
| `--vscode-badge-background`                         |
| `--vscode-badge-foreground`                         |
| `--vscode-button-background`                        |
| `--vscode-button-foreground`                        |
| `--vscode-diffEditor-insertedTextBackground`        |
| `--vscode-diffEditor-removedTextBackground`         |
| `--vscode-editor-background`                        |
| `--vscode-editor-findMatchBackground`               |
| `--vscode-editor-findMatchBorder`                   |
| `--vscode-editor-findMatchHighlightBackground`      |
| `--vscode-editor-font-family`                       |
| `--vscode-editor-font-size`                         |
| `--vscode-editor-foreground`                        |
| `--vscode-editorWarning-background`                 |
| `--vscode-editorWidget-background`                  |
| `--vscode-focusBorder`                              |
| `--vscode-foreground`                               |
| `--vscode-gitDecoration-addedResourceForeground`    |
| `--vscode-gitDecoration-deletedResourceForeground`  |
| `--vscode-gitDecoration-modifiedResourceForeground` |
| `--vscode-input-background`                         |
| `--vscode-input-border`                             |
| `--vscode-input-foreground`                         |
| `--vscode-inputValidation-errorBackground`          |
| `--vscode-list-activeSelectionBackground`           |
| `--vscode-list-hoverBackground`                     |
| `--vscode-list-inactiveSelectionBackground`         |
| `--vscode-menu-background`                          |
| `--vscode-menu-foreground`                          |
| `--vscode-menu-selectionBackground`                 |
| `--vscode-menu-selectionForeground`                 |
| `--vscode-menu-separatorBackground`                 |
| `--vscode-scrollbar-shadow`                         |
| `--vscode-sideBar-background`                       |
| `--vscode-toolbar-hoverBackground`                  |
| `--vscode-widget-border`                            |
| `--vscode-widget-shadow`                            |

## Syntax colours

The full-diff panel colours code with highlight.js classes (`hljs-*`), which
the stylesheet maps to these properties. A host may define any of them; each
one it leaves out falls back to a built-in light palette, or a dark one when
`body` carries `vscode-dark` or a dark `vscode-high-contrast`. VS Code does not expose its token colours to a
webview, so a VS Code host relies on the fallbacks.
[`docs/syntax-highlighting.md`](../../../../docs/syntax-highlighting.md)
describes the rest of the feature.

| Property | Covers |
| --- | --- |
| `--syntax-keyword` | keywords |
| `--syntax-string` | strings |
| `--syntax-comment` | comments and doc comments |
| `--syntax-number` | numbers |
| `--syntax-function` | function names at their definitions |
| `--syntax-type` | types, class names and built-ins |
| `--syntax-variable` | variables, parameters, properties and attributes |
| `--syntax-constant` | literals, symbols, regular expressions and links |
| `--syntax-meta` | preprocessor directives, annotations and decorators |
| `--syntax-tag` | markup tags, CSS selectors and Markdown headings |

Diff and Markdown additions and deletions reuse
`--vscode-gitDecoration-addedResourceForeground` and
`--vscode-gitDecoration-deletedResourceForeground`.
