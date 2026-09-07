/** Serializes simultaneous askpass requests without overwriting a typed answer. */
export class CredentialPrompts {
  private readonly pending: Array<{ id: string; message: string }> = [];

  constructor(
    private readonly show: (id: string, message: string) => void,
    private readonly hide: () => void,
    private readonly reply: (id: string, value: string) => void,
  ) {}

  receive(id: string, message: string): void {
    if (id === "" || this.pending.some((prompt) => prompt.id === id)) return;
    this.pending.push({ id, message });
    if (this.pending.length === 1) this.show(id, message);
  }

  answer(value: string): void {
    const current = this.pending.shift();
    if (current === undefined) return;
    this.reply(current.id, value);
    this.hide();
    const next = this.pending[0];
    if (next !== undefined) this.show(next.id, next.message);
  }
}
