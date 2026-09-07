/**
 * The host a `Username for '<url>'` or `Password for '<url>'` prompt names,
 * lowercased and stripped of a port. `null` for anything else Git might ask
 * (an SSH key passphrase, say) -- this dialog still shows those as one field.
 */
export function credentialPromptHost(message: string, kind: "Username" | "Password"): string | null {
  const match = new RegExp(`^${kind} for '[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/]*@)?([^/']+)'`).exec(
    message.trim(),
  );
  return match === null ? null : match[1].split(":")[0].toLowerCase();
}

/** Serializes simultaneous askpass requests without overwriting a typed answer. */
export class CredentialPrompts {
  private readonly pending: Array<{ id: string; message: string }> = [];
  /**
   * A password typed alongside a username, kept just long enough to answer
   * the password prompt Git asks moments later for the same host -- never
   * persisted, and cleared the moment it is used or a mismatched host arrives.
   */
  private pairedPassword: { host: string; value: string } | null = null;

  constructor(
    private readonly show: (id: string, message: string) => void,
    private readonly hide: () => void,
    private readonly reply: (id: string, value: string) => void,
  ) {}

  receive(id: string, message: string): void {
    if (id === "" || this.pending.some((prompt) => prompt.id === id)) return;
    const passwordHost = credentialPromptHost(message, "Password");
    if (passwordHost !== null && this.pairedPassword?.host === passwordHost) {
      this.reply(id, this.pairedPassword.value);
      this.pairedPassword = null;
      return;
    }
    this.pairedPassword = null;
    this.pending.push({ id, message });
    if (this.pending.length === 1) this.show(id, message);
  }

  /**
   * Answers the current prompt. `password` accompanies a username answer, so
   * the password prompt Git asks moments later for the same host is answered
   * without a second dialog.
   */
  answer(value: string, password?: string): void {
    const current = this.pending.shift();
    if (current === undefined) return;
    if (password !== undefined) {
      const host = credentialPromptHost(current.message, "Username");
      if (host !== null) this.pairedPassword = { host, value: password };
    }
    this.reply(current.id, value);
    this.hide();
    const next = this.pending[0];
    if (next !== undefined) this.show(next.id, next.message);
  }

  /**
   * Resolves the current prompt from outside the form -- a GitHub sign-in
   * completing in the background. A no-op once the prompt is already gone,
   * which is what a sign-in the user also cancelled from the form looks like.
   */
  resolve(id: string): void {
    const index = this.pending.findIndex((prompt) => prompt.id === id);
    if (index < 0) return;
    this.pending.splice(index, 1);
    if (index !== 0) return;
    this.hide();
    const next = this.pending[0];
    if (next !== undefined) this.show(next.id, next.message);
  }

  /** The prompt currently shown, or `null` when none is. */
  currentId(): string | null {
    return this.pending[0]?.id ?? null;
  }
}
