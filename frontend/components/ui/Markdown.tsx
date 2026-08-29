import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Maps markdown elements onto the app's own semantic Tailwind tokens rather
// than the Tailwind Typography `prose` plugin - that plugin isn't installed,
// and its hardcoded color palette would fight this app's CSS-variable-driven
// dark mode (see app/[locale]/globals.css).
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="font-headline-lg text-headline-lg text-on-surface mt-6 mb-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-headline-md text-headline-md text-on-surface mt-6 mb-3 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-headline-md text-headline-md text-on-surface mt-5 mb-2 first:mt-0">{children}</h3>
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
  blockquote: ({ children }) => (
    <blockquote className="border-s-4 border-outline-variant ps-4 italic text-on-surface-variant mb-4">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-outline-variant my-6" />,
  strong: ({ children }) => <strong className="font-bold text-on-surface">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  pre: ({ children }) => (
    <pre className="bg-surface-container-low border border-outline-variant rounded-xl p-4 overflow-x-auto font-mono-sm text-mono-sm text-on-surface-variant mb-4 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
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
