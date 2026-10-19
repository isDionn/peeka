import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ClaudeChatTab, resetClaudeChat } from "../components/ClaudeChat";

beforeEach(() => { fakeBridge.reset(); resetClaudeChat(); });
afterEach(cleanup);

const box = () => screen.getByLabelText("Message to Claude") as HTMLInputElement;
const type = async (text: string) => { await waitFor(() => expect(box().disabled).toBe(false)); fireEvent.change(box(), { target: { value: text } }); };

test("send: your pill, three dots, then the reply streams in; the box empties and Send comes back", async () => {
  render(<ClaudeChatTab still />);
  expect((await screen.findByRole("status")).textContent).toBe("Claude");
  await type("  hello  ");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByText("hello")).className).toContain("ccMe");
  expect(fakeBridge.log).toContainEqual({ cmd: "claude_chat_send", args: { text: "hello" } });
  expect(box().value).toBe("");
  if (!document.querySelector(".ccAi")?.textContent) expect(screen.getByLabelText("Claude is thinking")).toBeTruthy(); // a slow runner may already have the first words
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  await waitFor(() => expect(document.querySelector(".ccAi")?.textContent).toMatch(/^Hi! Happy to help\./));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(), { timeout: 3000 });
  expect(document.querySelector(".ccAi")?.textContent).toMatch(/think through\.$/);
  expect(screen.queryByLabelText("Claude is thinking")).toBeNull();
});

test("Stop ends the reply where it is; the next message still goes", async () => {
  render(<ClaudeChatTab still />);
  await type("hi");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(document.querySelector(".ccAi")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
  const cut = document.querySelector(".ccAi")!.textContent;
  await act(() => new Promise((r) => setTimeout(r, 200)));
  expect(document.querySelector(".ccAi")!.textContent).toBe(cut);
  expect(document.querySelector(".ccErr")).toBeNull();
});

test("Claude Code missing: grey pill, a hint and Check again; the box is disabled", async () => {
  fakeBridge.setClaudeChat({ available: false, version: null, signedIn: false });
  render(<ClaudeChatTab still />);
  expect(await screen.findByText("Claude Code not found")).toBeTruthy();
  expect((screen.getByRole("status")).className).not.toContain(" on");
  expect(box().disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  fakeBridge.setClaudeChat({ available: true, signedIn: true });
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(box().disabled).toBe(false));
});

test("errors show in the list: the CLI's own text, and the lock", async () => {
  fakeBridge.setClaudeChat({ error: "Not signed in" });
  render(<ClaudeChatTab still />);
  await type("hi");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByText("Not signed in")).className).toContain("ccErr");
  fakeBridge.setLocked(true);
  await type("again");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Peeka is locked. Unlock it to chat.")).toBeTruthy();
});

test("the box asks the island for the keyboard while focused", async () => {
  render(<ClaudeChatTab still />);
  await waitFor(() => expect(box().disabled).toBe(false));
  fireEvent.focus(box());
  fireEvent.blur(box());
  const focus = fakeBridge.log.filter((l) => l.cmd === "typing_focus").map((l) => l.args);
  expect(focus).toEqual([{ label: "island", on: true }, { label: "island", on: false }]);
  expect(box().maxLength).toBe(8000);
});
