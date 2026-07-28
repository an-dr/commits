# Standalone settings

The component saves UTF-8 JSON through bones' component-scoped persistence
endpoint. On disk, bones owns the save-file location and atomically replaces
the component save slot; the product owns only this versioned document:

```json
{"version":1,"commitLimit":250,"includeRemotes":true,"theme":"system"}
```

Invalid, unsupported, or missing settings fall back to these defaults. The
commit limit is deliberately bounded to 10–2,000 so a malformed file cannot
make a normal repository read unbounded.
