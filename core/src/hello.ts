import { log } from "bones:core/host-api@0.1.0";

export function init(): void {
  log("info", "hello from the TypeScript WASM component");
}

export function shutdown(): void {
  log("info", "hello TypeScript component stopped");
}

export function onTick(_dt: number): void {}

export function onMessage(
  _topic: string,
  _sender: string,
  _payload: Uint8Array,
): Uint8Array | undefined {
  return undefined;
}
