import Image from "next/image";
import type { Screenshot } from "@/content/site";
import { ArrowUpRight } from "./icons";

const isExternal = (href: string) => /^https?:\/\//.test(href);

/** Link styled as a button. External links open in a new tab with a hidden hint. */
export function LinkButton({
  href,
  variant = "primary",
  children,
  className = "",
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: React.ReactNode;
  className?: string;
}) {
  const ext = isExternal(href);
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-fg hover:bg-accent-hover"
      : "border border-line-strong text-fg hover:border-accent hover:text-accent";
  return (
    <a
      href={href}
      {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold transition-colors ${styles} ${className}`}
    >
      {children}
      {ext && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

/** Inline text link; external links get an arrow and open in a new tab. */
export function TextLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  const ext = isExternal(href);
  return (
    <a
      href={href}
      {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`inline-flex items-center gap-1 text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent ${className}`}
    >
      {children}
      {ext && <ArrowUpRight className="h-3.5 w-3.5" />}
      {ext && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

/** Section with a hairline top rule and a mono section index, like a drawing sheet. */
export function Section({
  id,
  index,
  eyebrow,
  children,
  className = "",
  labelledBy,
}: {
  id: string;
  index: string;
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`relative border-t border-line ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <p className="label mb-6 flex items-center gap-3">
          <span className="text-accent">{index}</span>
          <span aria-hidden="true" className="h-px w-8 bg-line-strong" />
          <span>{eyebrow}</span>
        </p>
        {children}
      </div>
    </section>
  );
}

/** Product screenshot in a restrained browser frame. */
export function BrowserFrame({
  shot,
  priority = false,
  sizes = "(min-width: 1152px) 1100px, 100vw",
  className = "",
}: {
  shot: Screenshot;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border border-line-strong bg-panel ${className}`} style={{ boxShadow: "var(--shot-shadow)" }}>
      <div className="flex h-8 items-center gap-1.5 border-b border-line px-3" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-fg-subtle/40" />
        <span className="h-2 w-2 rounded-full bg-fg-subtle/40" />
        <span className="h-2 w-2 rounded-full bg-fg-subtle/40" />
        <span className="label ml-3 truncate !text-[0.65rem]">athar · demo instance</span>
      </div>
      <Image
        src={shot.src}
        width={shot.width}
        height={shot.height}
        alt={shot.alt}
        sizes={sizes}
        priority={priority}
        className="block h-auto w-full"
      />
    </div>
  );
}
