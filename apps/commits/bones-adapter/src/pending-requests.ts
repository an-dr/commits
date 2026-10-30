/**
 * Requests waiting on a host result, keyed by the id they were sent with.
 *
 * Each entry says what kind of request it was and carries whatever the
 * result handler needs, so one table serves every kind a consumer sends.
 * `has` doubles as the in-flight guard for requests that must not run twice
 * at once, such as a clone into the same destination.
 */
export class PendingRequests<T extends { readonly kind: string }> {
  private readonly entries = new Map<number, T>();

  add(requestId: number, entry: T): void {
    this.entries.set(requestId, entry);
  }

  /** Removes and returns the entry for `requestId`, if one is waiting. */
  take(requestId: number): T | undefined {
    const entry = this.entries.get(requestId);
    if (entry !== undefined) this.entries.delete(requestId);
    return entry;
  }

  /** Whether any request of `kind` is still waiting. */
  has(kind: T["kind"]): boolean {
    for (const entry of this.entries.values()) {
      if (entry.kind === kind) return true;
    }
    return false;
  }
}
