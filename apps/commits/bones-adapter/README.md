# bones adapter

The WebAssembly guest: the glue that lets the shared product core run on bones.
It translates between the bones ABI and the host-independent contracts the
shared packages define.

This directory is adaptation, not product logic. Behavior that the VS Code
extension would also want belongs in `packages/`, reached here through the
`@an-dr/commits-core` alias. The bones ABI is touched in two places only:
`host/bones-host-port.ts` imports the host API, and `component.ts` exports the
extension entry points and routes engine messages to `CommitsCore`. Everything
else stays testable without a running engine.

`git/` turns the shared view's queries and actions into native Git requests,
`installation.ts` owns update, install, and desktop registration, and
`shared-core/` holds tests for the local changes to the shared view.

The page is requested from the host at run time rather than compiled in, so
rebuilding the page does not rebuild this component.

Startup is order-independent by design. The core bootstraps on the first page
message, supplies normalized settings in response to `standaloneReady`, and
waits for `standaloneViewReady` before announcing repositories. A repository
query that arrives early is still answered rather than dropped.
