import { expect, it, vi } from "vitest";
import { CredentialPrompts, credentialPromptHost } from "./credential-prompts";

it("queues simultaneous prompts and deduplicates repeats without resetting input", () => {
  const show = vi.fn(), hide = vi.fn(), reply = vi.fn();
  const prompts = new CredentialPrompts(show, hide, reply);
  prompts.receive("one", "Username");
  prompts.receive("two", "Password");
  prompts.receive("one", "Username");
  prompts.receive("two", "Password");
  expect(show.mock.calls).toEqual([["one", "Username"]]);
  prompts.answer("alice");
  expect(show.mock.calls).toEqual([["one", "Username"], ["two", "Password"]]);
  prompts.answer("");
  prompts.answer("ignored");
  expect(reply.mock.calls).toEqual([["one", "alice"], ["two", ""]]);
  expect(hide).toHaveBeenCalledTimes(2);
});

it("answers a paired password prompt itself, without showing it", () => {
  const show = vi.fn(), hide = vi.fn(), reply = vi.fn();
  const prompts = new CredentialPrompts(show, hide, reply);
  prompts.receive("user", "Username for 'https://github.com': ");
  prompts.answer("x-access-token", "ghp_secret");
  expect(hide).toHaveBeenCalledTimes(1);

  prompts.receive("pass", "Password for 'https://x-access-token@github.com': ");
  expect(show.mock.calls).toEqual([["user", "Username for 'https://github.com': "]]);
  expect(reply.mock.calls).toEqual([
    ["user", "x-access-token"],
    ["pass", "ghp_secret"],
  ]);
  // Used once: a second password prompt for the same host asks again rather
  // than replaying a value that may no longer be the right answer.
  prompts.receive("pass2", "Password for 'https://x-access-token@github.com': ");
  expect(show.mock.calls).toEqual([
    ["user", "Username for 'https://github.com': "],
    ["pass2", "Password for 'https://x-access-token@github.com': "],
  ]);
});

it("does not pair a password prompt for a different host", () => {
  const show = vi.fn(), hide = vi.fn(), reply = vi.fn();
  const prompts = new CredentialPrompts(show, hide, reply);
  prompts.receive("user", "Username for 'https://github.com': ");
  prompts.answer("me", "secret");
  prompts.receive("pass", "Password for 'https://me@gitlab.com': ");
  expect(show.mock.calls.at(-1)).toEqual(["pass", "Password for 'https://me@gitlab.com': "]);
});

it("resolves a prompt externally, the way a completing GitHub sign-in does", () => {
  const show = vi.fn(), hide = vi.fn(), reply = vi.fn();
  const prompts = new CredentialPrompts(show, hide, reply);
  prompts.receive("one", "Username for 'https://github.com': ");
  prompts.receive("two", "Password for 'https://example.com': ");
  expect(prompts.currentId()).toBe("one");

  prompts.resolve("one");
  expect(hide).toHaveBeenCalledTimes(1);
  expect(show.mock.calls.at(-1)).toEqual(["two", "Password for 'https://example.com': "]);
  expect(prompts.currentId()).toBe("two");
  // A stale id -- already answered or never shown -- is a no-op.
  prompts.resolve("one");
  expect(hide).toHaveBeenCalledTimes(1);
});

it("parses the host a credential prompt names, stripping a port and a username", () => {
  expect(credentialPromptHost("Username for 'https://github.com': ", "Username")).toBe("github.com");
  expect(credentialPromptHost("Password for 'https://x-access-token@github.com': ", "Password")).toBe(
    "github.com",
  );
  expect(credentialPromptHost("Username for 'https://example.com:8443': ", "Username")).toBe(
    "example.com",
  );
  expect(credentialPromptHost("Enter passphrase for key '/home/me/.ssh/id_ed25519': ", "Username")).toBe(
    null,
  );
});
