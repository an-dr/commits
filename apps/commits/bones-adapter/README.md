# Bones adapter

The WebAssembly guest: the glue that lets the shared product core run on Bones.
It translates between the Bones ABI and the host-independent contracts the
shared packages define.

This directory is adaptation, not product logic. Behavior that the VS Code
extension would also want belongs in `packages/`, reached here through the
`@an-dr/commits-core` alias. Only `host/bones-host-port.ts` imports the Bones
ABI, so everything else stays testable without a running engine.

The page is requested from the host at run time rather than compiled in, so
rebuilding the page does not rebuild this component.

Startup is order-independent by design. The core bootstraps on the first page
message, supplies normalized settings in response to `standaloneReady`, and
waits for `standaloneViewReady` before announcing repositories. A repository
query that arrives early is still answered rather than dropped.
