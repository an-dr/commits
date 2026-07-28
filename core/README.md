# commits core

Host-agnostic TypeScript product core compiled to a WebAssembly component.
Only `host/bones-host-port.ts` imports the bones host ABI. Product behavior
depends on `HostPort`, which a future VS Code adapter can also implement.

