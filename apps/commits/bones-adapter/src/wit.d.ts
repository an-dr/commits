declare module "bones:extension/host-api@1.0.0" {
  export function log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void;
  export function subscribe(topic: string): void;
  export function publish(topic: string, payload: Uint8Array): void;
  export function send(endpoint: string, payload: Uint8Array): Uint8Array;
}
