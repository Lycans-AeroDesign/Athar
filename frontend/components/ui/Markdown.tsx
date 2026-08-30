"use client";

import { useTranslations } from "next-intl";
import { isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Icon } from "./Icon";
import { slugify } from "@/lib/slug";

// react-markdown gives each fenced ```code block``` to `pre` as a single
// `code` child (react-markdown.dev's "syntax highlighting" recipe - there's
// no `inline` prop to check since react-markdown v9), so extracting the
// copy button's text means walking that child's own children rather than
// reading a prop react-markdown would hand us directly.
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

// Fenced code with a language tag (```param, ```bash, ...) gives react-markdown's
// `code` child a className="language-xxx" - pulled out here to show as a
// filename-bar-style label above the block, matching the Stitch reference's
// code blocks (which show a literal filename; a fence's language is the
// closest thing standard markdown syntax can express).
function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);

  const codeElement = Array.isArray(children) ? children[0] : children;
  const codeClassName = isValidElement(codeElement)
    ? (codeElement.props as { className?: string }).className
    : undefined;
  const language = codeClassName?.match(/language-(\w+)/)?.[1];

  async function handleCopy() {
    await navigator.clipboard.writeText(extractText(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-outline-variant overflow-hidden mb-4">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-container-high border-b border-outline-variant">
        <span className="font-mono-sm text-mono-sm text-on-surface-variant uppercase">{language ?? "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? t("copied") : t("copyCode")}
          title={copied ? t("copied") : t("copyCode")}
          className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <Icon name={copied ? "check" : "content_copy"} size={16} />
          {copied && <span className="font-label-caps text-label-caps uppercase">{t("copied")}</span>}
        </button>
      </div>
      <pre className="bg-surface-container-low p-4 overflow-x-auto font-mono-sm text-mono-sm text-on-surface-variant [&>code]:bg-transparent [&>code]:p-0">
        {children}
      </pre>
    </div>
  );
}

// Maps markdown elements onto the app's own semantic Tailwind tokens rather
// than the Tailwind Typography `prose` plugin - that plugin isn't installed,
// and its hardcoded color palette would fight this app's CSS-variable-driven
// dark mode (see app/[locale]/globals.css).
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="font-headline-lg text-headline-lg text-on-surface mt-6 mb-3 first:mt-0">{children}</h1>
  ),
  // id matches lib/toc.ts's extractHeadings() exactly, so the article page's
  // table-of-contents links land here.
  h2: ({ children }) => (
    <h2
      id={slugify(extractText(children))}
      className="font-headline-md text-headline-md text-on-surface mt-6 mb-3 first:mt-0 scroll-mt-6"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={slugify(extractText(children))}
      className="font-headline-md text-headline-md text-on-surface mt-5 mb-2 first:mt-0 scroll-mt-6"
    >
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="font-body-lg text-body-lg text-on-surface mb-4">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline hover:no-underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 mb-4 space-y-1 font-body-lg text-body-lg text-on-surface">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 mb-4 space-y-1 font-body-lg text-body-lg text-on-surface">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  // Rendered as a callout box (matching the Stitch reference's "Critical EKF
  // Dependency" warning) rather than a plain indented quote - markdown has no
  // dedicated callout syntax, and blockquote is the closest standard hook.
  blockquote: ({ children }) => (
    <blockquote className="bg-error-container border-s-4 border-error rounded-e-xl p-4 mb-4 flex gap-3 items-start">
      <Icon name="report_problem" size={20} className="text-on-error-container shrink-0 mt-0.5" />
      <div className="text-on-error-container font-body-md text-body-md [&>p]:mb-0 [&>p]:last:mb-0">{children}</div>
    </blockquote>
  ),
  hr: () => <hr className="border-outline-variant my-6" />,
  strong: ({ children }) => <strong className="font-bold text-on-surface">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  pre: CodeBlock,
  code: ({ children }) => (
    <code className="bg-surface-container-low text-primary rounded px-1.5 py-0.5 font-mono-sm text-mono-sm">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full border-collapse border border-outline-variant font-body-md text-body-md">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-outline-variant bg-surface-container-low px-3 py-2 text-start font-label-caps text-label-caps uppercase text-on-surface-variant">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-outline-variant px-3 py-2 text-on-surface">{children}</td>,
};

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
