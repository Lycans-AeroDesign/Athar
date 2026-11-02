import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { Skeleton, SkeletonPill, SkeletonRegion, SkeletonText } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import type { DocumentSummary } from "@/lib/api/types";
import { formatBytes } from "@/lib/bytes";
import { formatRelativeTime } from "@/lib/datetime";
import { formatCalendarDate } from "@/lib/format";
import { DOC_SOURCE_ICONS, DOC_TYPE_ICONS } from "@/lib/optionIcons";

const MAX_TAGS = 3;

export const DOCUMENT_CARD_GRID = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One document in the Documents grid view: type, title, byline, metadata, tags, and what's attached. */
export function DocumentCard({ document }: { document: DocumentSummary }) {
  const t = useTranslations("engineering.document");
  const docTypeT = useTranslations("engineering.documentType");
  const sourceT = useTranslations("engineering.documentSource");
  const byline = [document.author, document.organization].filter(Boolean).join(" · ");
  const extraTags = document.tags.length - MAX_TAGS;

  return (
    <Link
      href={`/documents/${document.id}`}
      className="group flex flex-col bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container/40 text-primary">
          <Icon name={DOC_TYPE_ICONS[document.doc_type].icon} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-label-caps text-label-caps uppercase text-primary truncate">
              {docTypeT(document.doc_type)}
            </span>
            {document.visibility === "RESTRICTED" && (
              <span
                className="flex items-center text-on-error-container bg-error-container rounded-full p-1 shrink-0"
                title={t("visibilityRESTRICTED")}
                aria-label={t("visibilityRESTRICTED")}
              >
                <Icon name="lock" size={12} />
              </span>
            )}
          </div>
          <h3 className="font-headline-md text-headline-md text-on-surface line-clamp-2 group-hover:text-primary transition-colors">
            {document.title}
          </h3>
        </div>
      </div>

      {byline && <p className="font-body-md text-body-md text-on-surface-variant truncate mb-2">{byline}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-sm text-mono-sm text-on-surface-variant mb-3">
        <span className="flex items-center gap-1">
          <Icon name={DOC_SOURCE_ICONS[document.source].icon} size={14} />
          {sourceT(document.source)}
        </span>
        {document.publication_date && (
          <span className="flex items-center gap-1">
            <Icon name="calendar_month" size={14} />
            {formatCalendarDate(document.publication_date)}
          </span>
        )}
        {document.category && (
          <span className="flex items-center gap-1 min-w-0">
            <Icon name="label" size={14} className="shrink-0" />
            <span className="truncate">{document.category.name}</span>
          </span>
        )}
      </div>

      {document.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {document.tags.slice(0, MAX_TAGS).map((tag) => (
            <span
              key={tag.id}
              className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full border border-outline-variant"
            >
              {tag.name}
            </span>
          ))}
          {extraTags > 0 && (
            <span className="font-mono-sm text-mono-sm text-on-surface-variant">{t("moreTags", { count: extraTags })}</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-3 border-t border-outline-variant font-mono-sm text-mono-sm text-on-surface-variant">
        {document.file ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <Icon name="description" size={14} className="shrink-0" />
            <span className="truncate">{document.file.original_filename}</span>
            <span className="shrink-0">· {formatBytes(document.file.size)}</span>
          </span>
        ) : document.url ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <Icon name="link" size={14} className="shrink-0" />
            <span className="truncate">{hostnameOf(document.url)}</span>
          </span>
        ) : (
          <span className="italic text-on-surface-variant/60">{t("noAttachment")}</span>
        )}
        <span className="flex items-center gap-1 shrink-0">
          <Icon name="update" size={14} />
          {formatRelativeTime(document.updated_at)}
        </span>
      </div>
    </Link>
  );
}

/** Mirrors DocumentCard above, block for block. */
export function DocumentCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion className={DOCUMENT_CARD_GRID}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col bg-surface-container-low border border-outline-variant rounded-xl p-4">
          <div className="flex items-start gap-3 mb-2">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <div className="min-w-0 flex-1">
              <SkeletonText variant="label-caps" width="w-24" />
              <SkeletonText variant="headline-md" width="w-4/5" />
            </div>
          </div>
          <SkeletonText width="w-1/2" className="mb-2" />
          <div className="flex flex-wrap items-center gap-x-3 mb-3">
            <SkeletonText variant="mono-sm" width="w-16" />
            <SkeletonText variant="mono-sm" width="w-20" />
            <SkeletonText variant="mono-sm" width="w-16" />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            <SkeletonPill className="w-14" />
            <SkeletonPill className="w-16" />
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
            <SkeletonText variant="mono-sm" width="w-36" />
            <SkeletonText variant="mono-sm" width="w-14" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
