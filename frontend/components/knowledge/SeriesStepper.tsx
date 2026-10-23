"use client";

import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import type { CollectionContentRef, CollectionContext } from "@/lib/api/types";

/** Detail-page routes by relatable type - mirrors the app's route tree
 * (app/[locale]/(protected)/*). 'question' and 'project' are valid item
 * types backend-side even though no series uses them today; the default
 * arm keeps a dangling link from rendering if one ever does. */
function hrefFor(ref: CollectionContentRef): string {
  switch (ref.type) {
    case "article":
      return `/knowledge/articles/${ref.id}`;
    case "sop":
      return `/sops/${ref.id}`;
    case "question":
      return `/knowledge/questions/${ref.id}`;
    case "component":
      return `/components/${ref.id}`;
    case "failure":
      return `/failures/${ref.id}`;
    case "test":
      return `/tests/${ref.id}`;
    case "document":
      return `/documents/${ref.id}`;
    case "project":
      return `/projects/${ref.id}`;
    default:
      return "";
  }
}

const ICON_FOR_TYPE: Record<string, string> = {
  article: "article",
  sop: "description",
  question: "forum",
  component: "settings_input_component",
  failure: "report_problem",
  test: "science",
  document: "description",
  project: "flight",
};

function ItemLink({ item, state }: { item: CollectionContentRef; state: "done" | "current" | "todo" }) {
  const href = hrefFor(item);
  const className =
    state === "current"
      ? "bg-primary text-on-primary border-primary"
      : "bg-surface-container text-on-surface-variant border-outline-variant hover:border-primary hover:text-on-surface";
  const content = (
    <>
      <Icon
        name={state === "done" ? "check_circle" : (ICON_FOR_TYPE[item.type] ?? "timelapse")}
        size={14}
        className="shrink-0"
      />
      <span className="truncate max-w-[220px]">{item.title}</span>
    </>
  );
  const common = `inline-flex items-center gap-1.5 border rounded-full px-3 py-1 font-label-md text-label-md transition-colors ${className}`;
  // "" href: the type is valid backend-side but this app has no route for
  // it - render the chip unlinked rather than directing to nowhere.
  return href ? (
    <Link href={href} className={common}>
      {content}
    </Link>
  ) : (
    <span className={common}>{content}</span>
  );
}

/** The "part of series / folder" banner on a SOP/article detail page: where
 * this document sits in its collection(s) and prev/next navigation, computed
 * over the nodes *this viewer* can see (see services.collections_context_for
 * backend-side). One stepper renders per collection the document belongs to. */
export function SeriesStepper({ context }: { context: CollectionContext }) {
  const t = useTranslations("knowledge.collections");

  const positionLabel =
    context.mode === "SERIES"
      ? t("stepper.phase", { position: context.position, total: context.total })
      : t("stepper.inFolder", { position: context.total });

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/collections/${context.id}`}
          className="inline-flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
        >
          <Icon name={context.mode === "SERIES" ? "format_list_numbered" : "folder_open"} size={18} className="text-primary shrink-0" />
          <span className="font-headline-sm font-normal text-headline-sm text-on-surface truncate">{context.title}</span>
        </Link>
        <span className="shrink-0 font-label-caps text-label-caps uppercase text-on-surface-variant">{positionLabel}</span>
      </div>

      {context.phase_title && (
        <p className="font-body-md text-body-md text-on-surface">{context.phase_title}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {context.items.map((item, index) => (
          <ItemLink
            key={item.id}
            item={item}
            state={index + 1 === context.position ? "current" : index + 1 < context.position ? "done" : "todo"}
          />
        ))}
      </div>

      {(context.prev_item || context.next_item) && (
        <div className="flex items-stretch gap-2 pt-1">
          {context.prev_item ? (
            <Link
              href={hrefFor(context.prev_item)}
              className="flex-1 min-w-0 flex items-center gap-2 bg-surface-container border border-outline-variant rounded-lg p-3 hover:border-primary transition-colors group"
            >
              <Icon name="arrow_back" size={18} className="text-on-surface-variant group-hover:text-primary shrink-0" />
              <span className="min-w-0">
                <span className="block font-label-caps text-label-caps uppercase text-on-surface-variant">
                  {t("stepper.previous")}
                </span>
                <span className="block font-body-md text-body-md text-on-surface truncate">{context.prev_item.title}</span>
              </span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {context.next_item ? (
            <Link
              href={hrefFor(context.next_item)}
              className="flex-1 min-w-0 flex items-center justify-end gap-2 bg-surface-container border border-outline-variant rounded-lg p-3 hover:border-primary transition-colors group text-end"
            >
              <span className="min-w-0 text-end">
                <span className="block font-label-caps text-label-caps uppercase text-on-surface-variant">
                  {t("stepper.next")}
                </span>
                <span className="block font-body-md text-body-md text-on-surface truncate">{context.next_item.title}</span>
              </span>
              <Icon name="arrow_forward" size={18} className="text-on-surface-variant group-hover:text-primary shrink-0" />
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </div>
      )}
    </div>
  );
}
