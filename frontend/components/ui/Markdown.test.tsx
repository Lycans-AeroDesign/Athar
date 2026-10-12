import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "./Markdown";
import messages from "@/i18n/messages/en.json";

// Mermaid needs a real layout engine (see MermaidDiagram.tsx) - irrelevant to
// what the renderer decides to hand it.
vi.mock("./MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid">{code}</div>,
}));

function renderMarkdown(content: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Markdown content={content} />
    </NextIntlClientProvider>,
  );
}

describe("Markdown", () => {
  afterEach(cleanup);

  it("renders GitHub-style callouts with their label and without the marker", () => {
    const { container } = renderMarkdown("> [!WARNING]\n> Disconnect the LiPo battery first.");
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Disconnect the LiPo battery first.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("[!WARNING]");
    expect(container.querySelector("blockquote")).toBeNull();
  });

  it("keeps a plain quote, and an unknown marker, as a normal blockquote", () => {
    const { container } = renderMarkdown("> Just a quote\n\n> [!BOGUS]\n> text");
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect(container.textContent).toContain("[!BOGUS]");
  });

  it("renders inline and display math with KaTeX", () => {
    const { container } = renderMarkdown("Lift is $C_L$ here.\n\n$$\nL = \\frac{1}{2}\\rho V^2 S C_L\n$$");
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("doesn't let KaTeX produce links from user content", () => {
    const { container } = renderMarkdown("$\\href{javascript:alert(1)}{x}$");
    expect(container.querySelector("a")).toBeNull();
  });

  it("highlights fenced code with a known language and leaves unknown ones plain", () => {
    const { container } = renderMarkdown("```python\ndef f():\n    return 1\n```\n\n```nosuchlang\nplain\n```");
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("def");
    expect(screen.getByText("plain")).toBeInTheDocument();
  });

  it("still hands mermaid blocks to the diagram renderer", () => {
    renderMarkdown("```mermaid\ngraph TD; A-->B\n```");
    expect(screen.getByTestId("mermaid")).toHaveTextContent("graph TD; A-->B");
  });

  it("renders task lists, strikethrough and footnotes", () => {
    const { container } = renderMarkdown("- [x] done\n- [ ] todo\n\n~~old~~ value[^1]\n\n[^1]: Source.");
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(container.querySelector("del")).toHaveTextContent("old");
    expect(container.querySelector("section[data-footnotes]")).toHaveTextContent("Source.");
    // Footnote links stay in the same tab.
    expect(container.querySelector('a[href^="#"]')).not.toHaveAttribute("target");
  });

  it("gives headings an id and a copy-link anchor", () => {
    renderMarkdown("## Wing Design");
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("id", "wing-design");
    expect(screen.getByRole("link", { name: "Copy link to this section" })).toHaveAttribute("href", "#wing-design");
  });

  it("captions standalone images with descriptive alt text but not with filenames", () => {
    const { container } = renderMarkdown(
      "![Airfoil lift curve](https://example.com/a.png)\n\n![IMG_1234.png](https://example.com/b.png)",
    );
    const captions = container.querySelectorAll("figcaption");
    expect(captions).toHaveLength(1);
    expect(captions[0]).toHaveTextContent("Airfoil lift curve");
    expect(screen.getAllByRole("button", { name: "Enlarge image" })).toHaveLength(2);
  });
});
