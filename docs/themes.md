# Session theme files

A caller passes `--theme-file <file>` to supply a palette for one session. Relative paths resolve against the caller's working directory. The host reads at most 256 KiB, once per launch or handoff. `--theme light|dark` selects the mode independently; otherwise Commits uses its appearance setting.

## Format

The JSON object has integer `version: 1`, string `name`, and `light` and `dark` objects. Each mode requires a `colours` object containing every key below. An optional `syntax` object must contain every syntax key if present; if absent, the built-in palette for that mode supplies syntax colors.

| Object | Keys |
| --- | --- |
| colours | canvas, surface, elevated, text, border, input, hover, selection, selectionText, accent, positive, negative, warning, shadow, urgencyAdvisory, urgencyCaution, urgencyWarning |
| syntax | keyword, string, comment, number, function, type, variable, constant, meta, tag |

Colors accept `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgba(r,g,b,a)`, with RGB channels in 0–255 and alpha in 0–1. Unknown keys are ignored. Missing keys, invalid colors, unsupported versions, unreadable files and malformed JSON reject the file with one non-modal notice naming the file and first problem. Commits uses its own palette when a file is rejected.

Urgency colors follow the [health contract](repository-health.md): advisory yellow-orange, caution red-orange, warning pink. Graph lane colors remain Commits' own.

## Example

```json
{
  "version": 1,
  "name": "Example",
  "light": { "colours": {
    "canvas": "#f3f3f3", "surface": "#eeeeee", "elevated": "#ffffff",
    "text": "#24292f", "border": "#c8c8c8", "input": "#ffffff",
    "hover": "#e8e8e8", "selection": "#d7e7ff", "selectionText": "#111111",
    "accent": "#007fd4", "positive": "#1a7f37", "negative": "#cf222e",
    "warning": "#9a6700", "shadow": "rgba(0,0,0,.25)",
    "urgencyAdvisory": "#a66a00", "urgencyCaution": "#bd421f", "urgencyWarning": "#b62665"
  } },
  "dark": { "colours": {
    "canvas": "#1e1e1e", "surface": "#181818", "elevated": "#252526",
    "text": "#d4d4d4", "border": "#454545", "input": "#313131",
    "hover": "#2a2d2e", "selection": "#04395e", "selectionText": "#ffffff",
    "accent": "#007fd4", "positive": "#89d185", "negative": "#f14c4c",
    "warning": "#cca700", "shadow": "rgba(0,0,0,.55)",
    "urgencyAdvisory": "#e5ad45", "urgencyCaution": "#fa845c", "urgencyWarning": "#ef7fac"
  } }
}
```
