declare module "bones:core/host-api@0.1.0" {
  export function log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void;
  export function subscribe(topic: string): void;
  export function send(endpoint: string, payload: Uint8Array): Uint8Array;
}
