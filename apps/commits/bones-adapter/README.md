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

Startup is order-independent by design. The shared view begins querying as soon
as it mounts, which can precede the page's readiness message, so the core
bootstraps on the first page message of any kind. A repository query that
arrives early is answered rather than dropped, because the view issues each
query once and never retries.
