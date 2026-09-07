import { expect, it, vi } from "vitest";
import { CredentialPrompts } from "./credential-prompts";

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
