import { Skeleton, SkeletonPill, SkeletonRegion, SkeletonText, type TableSkeletonCell } from "@/components/ui/Skeleton";

// Skeletons for the engineering list pages - each mirrors the card/row markup
// in the matching app/[locale]/(protected)/<section>/page.tsx.

const ENGINEERING_CARD_GRID = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";

/** projects/page.tsx card: status pill, title, tag chips. */
export function ProjectCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion className={ENGINEERING_CARD_GRID}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-surface-container-low border border-outline-variant rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <SkeletonPill className="w-20" />
          </div>
          <SkeletonText variant="headline-md" width="w-2/3" className="mb-2" />
          <div className="flex flex-wrap gap-1.5">
            <SkeletonPill className="w-14" />
            <SkeletonPill className="w-20" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** components/page.tsx grid card: category + pills, thumb + name, location, part/qty, 2-spec footer. */
export function ComponentCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion className={ENGINEERING_CARD_GRID}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col bg-surface-container-low border border-outline-variant rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <SkeletonText variant="label-caps" width="w-20" />
            <div className="flex items-center gap-1 ms-auto">
              <SkeletonPill className="w-16" />
              <SkeletonPill className="w-16" />
            </div>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <SkeletonText variant="headline-md" width="w-2/3" className="flex-1" />
          </div>
          <SkeletonText width="w-1/3" className="mb-1" />
          <div className="flex items-center justify-between gap-2 mb-3">
            <SkeletonText variant="mono-sm" width="w-24" />
            <SkeletonText variant="mono-sm" width="w-16" />
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-outline-variant pt-2">
            {[0, 1].map((spec) => (
              <div key={spec}>
                <SkeletonText variant="label-caps" width="w-16" />
                <SkeletonText width="w-20" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** sops/page.tsx rows: icon, title + category, optional "mandatory" pill. */
export function SopListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonRegion className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 bg-surface-container-low border border-outline-variant rounded-xl p-4"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Skeleton className="h-5 w-5 rounded-md shrink-0" />
            <div className="min-w-0 flex-1">
              <SkeletonText variant="headline-md" width={index % 2 ? "w-1/2" : "w-2/3"} />
              <SkeletonText variant="label-caps" width="w-24" />
            </div>
          </div>
          {index % 3 === 0 && <SkeletonPill className="w-20" />}
        </div>
      ))}
    </SkeletonRegion>
  );
}

// Column shapes for TableSkeleton, one entry per real column of each table.
export const COMPONENTS_TABLE_COLUMNS: TableSkeletonCell[] = [
  "thumb", "title", "text", "text", "text", "pill", "text", "text", "pill", "text", "text", "text", "text",
];
export const DOCUMENTS_TABLE_COLUMNS: TableSkeletonCell[] = ["title", "text", "text", "text"];
export const FAILURES_TABLE_COLUMNS: TableSkeletonCell[] = ["title", "text", "pill", "text", "pill"];
export const TESTS_TABLE_COLUMNS: TableSkeletonCell[] = ["title", "text", "text", "text", "pill", "pill"];
