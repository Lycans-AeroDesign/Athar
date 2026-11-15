import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "./MarkdownEditor";
import messages from "@/i18n/messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { preferences: { has_seen_markdown_help: true } }, updateUser: () => {} }),
}));
vi.mock("@/lib/api/knowledge", () => ({
  searchKnowledge: vi.fn(() => Promise.resolve({ results: [] })),
  createRelation: vi.fn(() => Promise.resolve()),
}));
vi.mock("./ImageCropModal", () => ({ ImageCropModal: () => null }));
vi.mock("./MermaidDiagram", () => ({ MermaidDiagram: () => null }));

// jsdom has no layout, so no ResizeObserver - the highlight layer's sizing is a no-op here.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const MOTOR ="/components/3f2b1c4e-0000-4000-8000-000000000001";

let stored = "";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor
      value={value}
      onChange={(next) => {
        stored = next;
        setValue(next);
      }}
    />
  );
}

function setup(initial: string) {
  stored = initial;
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Harness initial={initial} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function placeCaret(textarea: HTMLTextAreaElement, start: number, end = start) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
}

describe("MarkdownEditor @-mentions", () => {
  afterEach(cleanup);

  it("shows the mention as @Title and highlights it", () => {
    const textarea = setup(`Hi [Motor](${MOTOR}) there`);
    expect(textarea.value).toBe("Hi @Motor there");
    expect(document.querySelector("mark")?.textContent).toBe("@Motor");
  });

  it("Backspace right after a mention deletes the whole mention", () => {
    const textarea = setup(`Hi [Motor](${MOTOR}) there`);
    placeCaret(textarea, "Hi @Motor".length);
    fireEvent.keyDown(textarea, { key: "Backspace" });
    expect(stored).toBe("Hi  there");
  });

  it("Delete right before a mention deletes the whole mention", () => {
    const textarea = setup(`Hi [Motor](${MOTOR}) there`);
    placeCaret(textarea, "Hi ".length);
    fireEvent.keyDown(textarea, { key: "Delete" });
    expect(stored).toBe("Hi  there");
  });

  it("Backspace elsewhere is left to the browser", () => {
    const textarea = setup(`Hi [Motor](${MOTOR}) there`);
    placeCaret(textarea, "Hi @Motor th".length);
    const notPrevented = fireEvent.keyDown(textarea, { key: "Backspace" });
    expect(notPrevented).toBe(true);
    expect(stored).toBe(`Hi [Motor](${MOTOR}) there`);
  });

  it("deleting a selection that cuts into a mention removes all of it", () => {
    const textarea = setup(`Hi [Motor](${MOTOR}) there`);
    placeCaret(textarea, 1, "Hi @Mo".length);
    fireEvent.keyDown(textarea, { key: "Backspace" });
    expect(stored).toBe("H there");
  });

  it("a caret placed inside a mention snaps to its nearest edge", () => {
    const textarea = setup(`Hi [Motor](${MOTOR}) there`);
    placeCaret(textarea, "Hi @M".length);
    act(() => {
      fireEvent.select(textarea);
    });
    expect(textarea.selectionStart).toBe("Hi ".length);
  });

  it("switching back from Preview focuses the editor where you left off", () => {
    const textarea = setup("Some text here");
    placeCaret(textarea, 4);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const reopened = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(reopened);
    expect(reopened.selectionStart).toBe(4);
  });

  it("puts the caret at the end when the editor was never clicked into", () => {
    setup("Some text here");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const reopened = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(reopened);
    expect(reopened.selectionStart).toBe("Some text here".length);
  });
});
