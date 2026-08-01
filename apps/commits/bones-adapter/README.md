# commits Bones component

GPL-licensed Bones host adapter and orchestration compiled to a WebAssembly
component. The unchanged shared MIT product package lives in `packages/core`.
Only `host/bones-host-port.ts` imports the Bones ABI; the adjacent
`commits-core-workspace-port.ts` adapts native repository paths to the shared
core's host contract.

