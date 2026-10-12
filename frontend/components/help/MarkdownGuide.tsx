import { getTranslations } from "next-intl/server";

import { Markdown } from "@/components/ui/Markdown";

const EXAMPLES = [
  "headings",
  "emphasis",
  "lists",
  "tasks",
  "links",
  "images",
  "quote",
  "callouts",
  "table",
  "code",
  "math",
  "diagram",
  "footnotes",
] as const;

// Image examples can't render without a real uploaded file, so that one shows
// its syntax and explanation only.
const SYNTAX_ONLY = new Set<(typeof EXAMPLES)[number]>(["images"]);

// Markdown reference - each example's source next to what Markdown.tsx
// actually renders from it, so the guide can't drift from the real renderer.
// Syntax is read with t.raw(): LaTeX braces would otherwise be parsed as ICU
// message placeholders.
export async function MarkdownGuide() {
  const t = await getTranslations("help.writing");

  return (
    <div className="space-y-6">
      <p className="font-body-lg text-body-lg text-on-surface-variant max-w-3xl">{t("intro")}</p>

      {EXAMPLES.map((key) => {
        const syntax = t.raw(`examples.${key}.syntax`) as string;
        const note = t.has(`examples.${key}.note`) ? t(`examples.${key}.note`) : null;
        return (
          <section key={key} className="bg-surface rounded-xl border border-outline-variant overflow-hidden">
            <div className="px-5 pt-4 pb-3">
              <h2 className="font-headline-md text-headline-md text-on-surface">{t(`examples.${key}.title`)}</h2>
              {note && <p className="font-body-md text-body-md text-on-surface-variant mt-1 max-w-3xl">{note}</p>}
            </div>
            {/* Stacked rather than side by side: at half width, code blocks,
                tables and diagrams overflowed into their own scrollbars. */}
            <div className="border-t border-outline-variant">
              <div className="p-5 bg-surface-container-low min-w-0">
                <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">{t("youType")}</p>
                <pre
                  dir="auto"
                  className="font-mono-sm text-mono-sm text-on-surface whitespace-pre-wrap wrap-break-word"
                >
                  {syntax}
                </pre>
              </div>
              {!SYNTAX_ONLY.has(key) && (
                <div className="p-5 min-w-0 border-t border-outline-variant">
                  <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">{t("youGet")}</p>
                  <Markdown content={syntax} />
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
