import { log } from "bones:extension/host-api@1.0.0";

// The ABI exports live in the `bones:extension/extension-api` interface
// rather than at world level, so the guest hands the host one namespace
// object instead of four bare functions.
export const extensionApi = {
  init(): void {
    log("info", "hello from the TypeScript WASM component");
  },

  shutdown(): void {
    log("info", "hello TypeScript component stopped");
  },

  onTick(_dt: number): void {},

  onMessage(
    _topic: string,
    _sender: string,
    _payload: Uint8Array,
  ): Uint8Array | undefined {
    return undefined;
  },
};
