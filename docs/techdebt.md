# Technical debt

| ID | Bug description | Source file | Test file |
| --- | --- | --- | --- |
| BUG-001 | Standalone startup begins evaluating the shared graph module before settings initialize its required global `viewState`, so module evaluation fails and only the static shell remains visible. | `apps/commits/web/src/main.ts` | `apps/commits/web/src/startup-order.test.ts` |
