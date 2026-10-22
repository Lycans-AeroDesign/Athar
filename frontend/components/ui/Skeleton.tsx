interface SkeletonProps {
  className?: string;
}

/** Base pulsing placeholder block using semantic surface tokens. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-surface-variant/70 ${className}`}
    />
  );
}

interface CardGridSkeletonProps {
  count?: number;
  columns?: 2 | 3;
  hasCover?: boolean;
}

/** Grid of card skeletons for card-based directory pages (Projects, Components, Knowledge, Training). */
export function CardGridSkeleton({
  count = 6,
  columns = 3,
  hasCover = false,
}: CardGridSkeletonProps) {
  const gridCols =
    columns === 2
      ? "grid-cols-1 xl:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";

  return (
    <div
      role="status"
      aria-busy="true"
      className={`grid ${gridCols} gap-4`}
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="bg-surface-container-low border border-outline-variant rounded-xl overflow-hidden p-4 space-y-3"
        >
          {hasCover && <Skeleton className="h-32 w-full rounded-lg" />}
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-14 rounded-md" />
          </div>
          <Skeleton className="h-6 w-3/4" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

/** Table skeleton for tabular list pages (Components table, Failures, Tests, Documents, Audit Log, Platform). */
export function TableSkeleton({ rows = 6, columns = 5 }: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="rounded-xl border border-outline-variant overflow-hidden bg-surface"
    >
      <div
        className="grid gap-4 bg-surface-container-low border-b border-outline-variant px-4 py-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, colIdx) => (
          <Skeleton key={colIdx} className="h-4 w-24" />
        ))}
      </div>
      <div className="divide-y divide-outline-variant">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="grid gap-4 items-center px-4 py-3.5"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton
                key={colIdx}
                className={
                  colIdx === 0
                    ? "h-5 w-4/5"
                    : colIdx === columns - 1
                      ? "h-6 w-20 rounded-full"
                      : "h-4 w-2/3"
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ListSkeletonProps {
  rows?: number;
  compact?: boolean;
}

/** Stacked row skeletons for list-based pages and panels (SOPs, Bookmarks, Search, Policies, Settings lists). */
export function ListSkeleton({ rows = 5, compact = false }: ListSkeletonProps) {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={`bg-surface-container-low border border-outline-variant rounded-xl ${
            compact ? "px-4 py-3" : "p-4"
          } flex items-center justify-between gap-4`}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-1/2 max-w-xs" />
            </div>
            {!compact && <Skeleton className="h-4 w-3/4 max-w-md" />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface DetailPageSkeletonProps {
  withSidebar?: boolean;
}

/** Two-column detail page skeleton matching engineering, knowledge, and course detail layouts. */
export function DetailPageSkeleton({ withSidebar = true }: DetailPageSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col lg:flex-row gap-8 items-start"
    >
      <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
        <Skeleton className="h-4 w-28" />

        <div className="border-t-4 border-primary/40 rounded-t-xl bg-surface pt-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-9 w-9 rounded-lg" />
            </div>
          </div>

          <Skeleton className="h-9 w-3/4" />

          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-32 w-full rounded-xl mt-4" />
        </div>

        <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>

      {withSidebar && (
        <aside className="w-full lg:w-72 shrink-0 bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </aside>
      )}
    </div>
  );
}

/** Centered form skeleton for entity edit pages. */
export function EditorPageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="max-w-[800px] mx-auto space-y-5"
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-56" />

      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Lesson player skeleton with curriculum sidebar and lesson content area. */
export function CourseLearnPageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col lg:flex-row gap-8 items-start"
    >
      <aside className="w-full lg:w-72 shrink-0 bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="space-y-2 pt-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <Skeleton key={idx} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      </aside>

      <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-2/3" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </div>
    </div>
  );
}

/** User profile and contributions skeleton. */
export function ProfilePageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="max-w-5xl mx-auto space-y-6">
      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-6 flex flex-col sm:flex-row items-start gap-5">
        <Skeleton className="w-20 h-20 rounded-full shrink-0" />
        <div className="flex-1 min-w-0 space-y-3 w-full">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-3/4 max-w-md" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-2"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>

      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>

      <ListSkeleton rows={4} />
    </div>
  );
}

/** Settings section form skeleton. */
export function FormSectionSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4 max-w-2xl">
      {Array.from({ length: fields }).map((_, idx) => (
        <div
          key={idx}
          className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-2"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-10 w-28 rounded-lg" />
    </div>
  );
}

/** Route-level page skeleton with header, filter bar, and card grid. */
export function PageShellSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <CardGridSkeleton count={6} />
    </div>
  );
}
