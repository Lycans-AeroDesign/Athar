"use client";

import cmake from "highlight.js/lib/languages/cmake";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import matlab from "highlight.js/lib/languages/matlab";
import "katex/dist/katex.min.css";
import { common } from "lowlight";
import { useTranslations } from "next-intl";
import { isValidElement, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { AuthenticatedImage } from "./AuthenticatedImage";
import { Icon } from "./Icon";
import { ImageLightbox } from "./ImageLightbox";
import { MermaidDiagram } from "./MermaidDiagram";
import { downloadFile } from "@/lib/api/files";
import { CALLOUT_TYPES, remarkCallouts, type CalloutType } from "@/lib/markdownCallouts";
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
      <pre className="bg-surface-container-low p-4 overflow-x-auto font-mono-sm text-mono-sm text-on-surface-variant [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-on-surface">
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
// Clicking any image opens it full-screen (ImageLightbox), captioned with
// its alt text when that alt text is a real description.
function ImageRenderer({ src, alt }: { src?: string | Blob; alt?: string }) {
  const t = useTranslations("markdown");
  const [zoomed, setZoomed] = useState(false);
  const caption = imageCaption(alt);

  function renderImage(className: string) {
    return typeof src === "string" && src.startsWith("/api/v1/files/") ? (
      <AuthenticatedImage src={src} alt={alt ?? ""} className={className} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- markdown content, not a local/optimizable asset.
      <img src={src} alt={alt ?? ""} className={className} />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={t("zoomImage")}
        title={t("zoomImage")}
        className="inline-block max-w-full align-top cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
      >
        {renderImage("rounded-lg max-w-full")}
      </button>
      <ImageLightbox open={zoomed} onOpenChange={setZoomed} caption={caption}>
        {renderImage("max-w-full max-h-[80vh] object-contain rounded-lg")}
      </ImageLightbox>
    </>
  );
}

// Images uploaded through the editor get their filename as alt text (see
// MarkdownEditor.tsx's uploadAndInsert) - that isn't worth showing as a
// caption, so only alt text that doesn't look like a filename counts.
function imageCaption(alt: string | undefined): string | undefined {
  const trimmed = alt?.trim();
  if (!trimmed || /\.[a-z0-9]{2,5}$/i.test(trimmed)) return undefined;
  return trimmed;
}

// A markdown line that's just `![alt](url)` parses as a <p> containing only
// an <img> - CommonMark has no "block image" syntax of its own. Rendering
// that literally would put ImageRenderer's <img>/<AuthenticatedImage>
// (which has a <span> loading placeholder) inside a <p>, which is fine for
// a bare <img> but invalid HTML the moment there's any wrapper element
// involved. Unwrapping the <p> whenever an image is its only real content
// sidesteps that entirely rather than trying to keep every possible
// image-adjacent element inline-safe.
// Returns that image's alt text (possibly "") when it is, null otherwise -
// a standalone image renders as a <figure> with its alt as the caption.
function standaloneImageAlt(children: ReactNode): string | null {
  const nodes = Array.isArray(children) ? children : [children];
  const meaningful = nodes.filter((node) => !(typeof node === "string" && node.trim() === ""));
  const only = meaningful[0];
  if (meaningful.length !== 1 || !isValidElement(only) || only.type !== ImageRenderer) return null;
  return (only.props as { alt?: string }).alt ?? "";
}

// A link to that same auth-gated download endpoint - see
// FILE_DOWNLOAD_HREF_PATTERN above - downloads via apiFetch instead of
// navigating; anything else (an external URL someone pasted or typed by
// hand) renders as a normal <a target="_blank">.
function FileAwareLink({ href, id, children }: { href?: string; id?: string; children?: ReactNode }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const fileId = typeof href === "string" ? FILE_DOWNLOAD_HREF_PATTERN.exec(href)?.[1] : undefined;

  // In-page anchors (footnote references and their back-links) - same tab,
  // and the id is kept since the back-links point at it.
  if (href?.startsWith("#")) {
    return (
      <a href={href} id={id} className="text-primary hover:underline">
        {children}
      </a>
    );
  }

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

const HEADING_CLASSES = {
  1: "font-headline-lg text-headline-lg text-on-surface mt-6 mb-3 first:mt-0 scroll-mt-6",
  2: "font-headline-md text-headline-md text-on-surface mt-6 mb-3 first:mt-0 scroll-mt-6",
  3: "font-headline-md text-headline-md text-on-surface mt-5 mb-2 first:mt-0 scroll-mt-6",
} as const;

// id matches lib/toc.ts's extractHeadings() exactly, so the article page's
// table-of-contents links land here. The hover link icon puts that #id in
// the address bar and copies the full URL, for linking straight to a section.
function Heading({ level, children }: { level: 1 | 2 | 3; children?: ReactNode }) {
  const t = useTranslations("markdown");
  const [copied, setCopied] = useState(false);
  const id = slugify(extractText(children));
  const Tag = `h${level}` as const;

  async function handleCopyLink(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    window.history.replaceState(window.history.state, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. insecure context) - the URL is still updated.
    }
  }

  return (
    <Tag id={id || undefined} className={`group ${HEADING_CLASSES[level]}`}>
      {children}
      {id && (
        <a
          href={`#${id}`}
          onClick={handleCopyLink}
          aria-label={copied ? t("linkCopied") : t("copySectionLink")}
          title={copied ? t("linkCopied") : t("copySectionLink")}
          className="ms-2 inline-flex align-middle text-on-surface-variant hover:text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <Icon name={copied ? "check" : "link"} size={16} />
        </a>
      )}
    </Tag>
  );
}

// GitHub-alert-style callouts (`> [!NOTE]` etc.) - see lib/markdownCallouts.ts,
// which tags the blockquote with data-callout for this to pick up. Full
// class strings (not built from the type name) so Tailwind sees them.
const CALLOUT_STYLES: Record<CalloutType, { icon: string; box: string; title: string }> = {
  note: { icon: "info", box: "border-callout-note bg-callout-note/10", title: "text-callout-note" },
  tip: { icon: "lightbulb", box: "border-callout-tip bg-callout-tip/10", title: "text-callout-tip" },
  important: {
    icon: "feedback",
    box: "border-callout-important bg-callout-important/10",
    title: "text-callout-important",
  },
  warning: { icon: "report_problem", box: "border-callout-warning bg-callout-warning/10", title: "text-callout-warning" },
  caution: { icon: "report", box: "border-callout-caution bg-callout-caution/10", title: "text-callout-caution" },
};

function isCalloutType(value: unknown): value is CalloutType {
  return typeof value === "string" && (CALLOUT_TYPES as readonly string[]).includes(value);
}

function Blockquote({ children, ...props }: { children?: ReactNode; "data-callout"?: string }) {
  const t = useTranslations("markdown");
  const type = props["data-callout"];

  if (!isCalloutType(type)) {
    return (
      <blockquote className="border-s-4 border-outline-variant ps-4 py-1 mb-4 [&>p]:text-on-surface-variant [&>*:last-child]:mb-0">
        {children}
      </blockquote>
    );
  }

  const style = CALLOUT_STYLES[type];
  return (
    <div className={`border-s-4 rounded-e-xl px-4 py-3 mb-4 ${style.box}`}>
      <p className={`flex items-center gap-2 font-label-caps text-label-caps uppercase mb-1.5 ${style.title}`}>
        <Icon name={style.icon} size={16} />
        {t(`callout.${type}`)}
      </p>
      <div className="[&>p]:font-body-md [&>p]:text-body-md [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

// Maps markdown elements onto the app's own semantic Tailwind tokens rather
// than the Tailwind Typography `prose` plugin - that plugin isn't installed,
// and its hardcoded color palette would fight this app's CSS-variable-driven
// dark mode (see app/[locale]/globals.css).
const COMPONENTS: Components = {
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  // GFM's footnote section carries its own visually-hidden "Footnotes" h2 -
  // kept as-is rather than styled/anchored like a real heading.
  h2: ({ children, id, className }) =>
    className?.includes("sr-only") ? (
      <h2 id={id} className="sr-only">
        {children}
      </h2>
    ) : (
      <Heading level={2}>{children}</Heading>
    ),
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  p: ({ children }) => {
    const imageAlt = standaloneImageAlt(children);
    if (imageAlt === null) return <p className="font-body-lg text-body-lg text-on-surface mb-4">{children}</p>;
    const caption = imageCaption(imageAlt);
    return (
      <figure className="mb-4">
        {children}
        {caption && (
          <figcaption className="mt-1.5 font-body-md text-body-md text-on-surface-variant">{caption}</figcaption>
        )}
      </figure>
    );
  },
  a: FileAwareLink,
  // GFM task lists (`- [ ] item`) get className="contains-task-list" - their
  // checkbox replaces the bullet.
  ul: ({ children, className }) => (
    <ul
      className={`${className?.includes("contains-task-list") ? "list-none ps-1" : "list-disc ps-6"} mb-4 space-y-1 font-body-lg text-body-lg text-on-surface`}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 mb-4 space-y-1 font-body-lg text-body-lg text-on-surface">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        className="me-2 h-4 w-4 align-middle accent-primary disabled:opacity-100"
      />
    ) : null,
  del: ({ children }) => <del className="line-through text-on-surface-variant">{children}</del>,
  sup: ({ children }) => <sup className="text-[0.75em] leading-none">{children}</sup>,
  // GFM footnotes ([^1]) - rendered as a compact section after the body.
  section: ({ children, ...props }) =>
    "data-footnotes" in props ? (
      <section
        data-footnotes
        className="mt-8 pt-4 border-t border-outline-variant [&_p]:font-body-md [&_p]:text-body-md [&_p]:text-on-surface-variant [&_p]:mb-1 [&_ol]:font-body-md [&_ol]:text-body-md"
      >
        {children}
      </section>
    ) : (
      <section>{children}</section>
    ),
  blockquote: Blockquote,
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

const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm, remarkMath, remarkCallouts];

// KaTeX runs with its defaults - notably trust: false, so \href/\url/
// \includegraphics in user content can't produce links or load anything.
// Highlighting only applies to fences that name a language (no
// auto-detection); unknown languages are left as plain text, and mermaid is
// skipped since CodeBlock hands it to MermaidDiagram instead.
const REHYPE_PLUGINS: Options["rehypePlugins"] = [
  rehypeKatex,
  [
    rehypeHighlight,
    {
      languages: { ...common, cmake, dockerfile, matlab },
      // ROS launch files and robot descriptions are XML.
      aliases: { xml: ["launch", "urdf", "xacro", "sdf"] },
      plainText: ["mermaid"],
    },
  ],
];

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    // wrap-break-word (inherited by every block inside) so a long pasted URL or
    // unbroken word wraps instead of pushing past a phone-width screen.
    <div className={`wrap-break-word ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
