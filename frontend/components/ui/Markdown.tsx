"use client";

import { useTranslations } from "next-intl";
import { isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { AuthenticatedImage } from "./AuthenticatedImage";
import { Icon } from "./Icon";
import { MermaidDiagram } from "./MermaidDiagram";
import { downloadFile } from "@/lib/api/files";
import { slugify } from "@/lib/slug";

// Matches ImageRenderer's own /api/v1/files/ check below - a non-image file
// uploaded through the editor (see MarkdownEditor.tsx's uploadAndInsert)
// embeds as [filename](/api/v1/files/<id>/download/), which is the same
// auth-gated (Bearer-only) endpoint AuthenticatedImage works around. A plain
// <a href> to it is a direct browser navigation with no Bearer header, which
// the backend can't authenticate - it doesn't 404, it errors out (see
// backend/files/views.py). Downloading via apiFetch instead of navigating
// fixes that the same way AuthenticatedImage does for images.
const FILE_DOWNLOAD_HREF_PATTERN = /^\/api\/v1\/files\/([^/]+)\/download\/?$/;

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

  if (language === "mermaid") {
    return <MermaidDiagram code={extractText(children)} />;
  }

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

// Files uploaded through the editor (see MarkdownEditor.tsx's paste/drop
// handling) embed as ![alt](/api/v1/files/<id>/download/) - that endpoint
// is auth-gated (Bearer header only, see backend/files/views.py), which a
// plain <img src> can never send, so it's routed through AuthenticatedImage
// instead. Anything else (an external URL someone pasted or typed by hand)
// renders as a normal <img>. Named (not inline in COMPONENTS) so the `p`
// component below can recognize "a paragraph containing only an image" by
// element type and unwrap it - see that comment for why.
function ImageRenderer({ src, alt }: { src?: string | Blob; alt?: string }) {
  return typeof src === "string" && src.startsWith("/api/v1/files/") ? (
    <AuthenticatedImage src={src} alt={alt ?? ""} className="rounded-lg max-w-full mb-4" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- markdown content, not a local/optimizable asset.
    <img src={src} alt={alt ?? ""} className="rounded-lg max-w-full mb-4" />
  );
}

// A markdown line that's just `![alt](url)` parses as a <p> containing only
// an <img> - CommonMark has no "block image" syntax of its own. Rendering
// that literally would put ImageRenderer's <img>/<AuthenticatedImage>
// (which has a <span> loading placeholder) inside a <p>, which is fine for
// a bare <img> but invalid HTML the moment there's any wrapper element
// involved. Unwrapping the <p> whenever an image is its only real content
// sidesteps that entirely rather than trying to keep every possible
// image-adjacent element inline-safe.
function isStandaloneImageParagraph(children: ReactNode): boolean {
  const nodes = Array.isArray(children) ? children : [children];
  const meaningful = nodes.filter((node) => !(typeof node === "string" && node.trim() === ""));
  return meaningful.length === 1 && isValidElement(meaningful[0]) && meaningful[0].type === ImageRenderer;
}

// A link to that same auth-gated download endpoint - see
// FILE_DOWNLOAD_HREF_PATTERN above - downloads via apiFetch instead of
// navigating; anything else (an external URL someone pasted or typed by
// hand) renders as a normal <a target="_blank">.
function FileAwareLink({ href, children }: { href?: string; children?: ReactNode }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const fileId = typeof href === "string" ? FILE_DOWNLOAD_HREF_PATTERN.exec(href)?.[1] : undefined;

  if (fileId) {
    return (
      <a
        href={href}
        aria-busy={isDownloading}
        className="text-primary underline hover:no-underline cursor-pointer"
        onClick={(e) => {
          e.preventDefault();
          if (isDownloading) return;
          setIsDownloading(true);
          downloadFile(fileId, extractText(children) || fileId).finally(() => setIsDownloading(false));
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <a href={href} className="text-primary underline hover:no-underline" target="_blank" rel="noreferrer">
      {children}
    </a>
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
  p: ({ children }) =>
    isStandaloneImageParagraph(children) ? (
      <>{children}</>
    ) : (
      <p className="font-body-lg text-body-lg text-on-surface mb-4">{children}</p>
    ),
  a: FileAwareLink,
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
  img: ImageRenderer,
};

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    // wrap-break-word (inherited by every block inside) so a long pasted URL or
    // unbroken word wraps instead of pushing past a phone-width screen.
    <div className={`wrap-break-word ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
