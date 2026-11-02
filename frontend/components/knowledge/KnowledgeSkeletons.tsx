import {
  Skeleton,
  SkeletonBackLink,
  SkeletonButton,
  SkeletonIconButton,
  SkeletonPill,
  SkeletonRegion,
  SkeletonText,
} from "@/components/ui/Skeleton";

import { KnowledgeCardSkeleton } from "./ArticleCard";

// Skeletons for knowledge-side screens; each mirrors the markup named in its doc comment.

/** SearchResultsPanel.tsx result rows: type badge, title, 2-line excerpt. */
export function SearchResultsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonRegion className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="bg-surface-container-low border border-outline-variant rounded-xl p-4">
          <SkeletonText variant="label-caps" width="w-20" className="mb-1" />
          <SkeletonText variant="headline-md" width={index % 2 ? "w-1/2" : "w-2/3"} className="mb-1" />
          <SkeletonText lines={2} width="w-full" lastWidth="w-3/5" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** CollectionShelf.tsx: header row + horizontal strip of w-64 collection cards. */
export function CollectionShelfSkeleton() {
  return (
    <SkeletonRegion className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SkeletonText variant="headline-md" width="w-40" />
        <SkeletonButton className="w-32" />
      </div>
      <div className="flex gap-3 overflow-hidden pb-1">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="shrink-0 w-64 flex flex-col gap-1 bg-surface-container-low border border-outline-variant rounded-xl p-4"
          >
            <SkeletonText variant="label-caps" width="w-16" />
            <SkeletonText variant="body-lg" width="w-3/4" />
            <SkeletonText variant="body-lg" width="w-20" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** collections/[id]/page.tsx: single 800px column, header, description, numbered item list. */
export function CollectionDetailSkeleton() {
  return (
    <SkeletonRegion className="space-y-6 max-w-[800px]">
      <SkeletonBackLink />
      <div className="border-t-4 border-primary/40 rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SkeletonPill className="w-20" />
          <div className="flex items-center gap-2">
            <SkeletonIconButton />
            <SkeletonIconButton />
          </div>
        </div>
        <SkeletonText variant="display" width="w-2/3" />
        <SkeletonText variant="mono-sm" width="w-40" />
      </div>
      <SkeletonText lines={2} width="w-full" lastWidth="w-1/2" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-xl p-4 bg-surface-container-low border border-outline-variant"
          >
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="min-w-0 flex-1">
              <SkeletonText variant="body-lg" width={index % 2 ? "w-1/2" : "w-2/3"} />
            </div>
            <Skeleton className="h-4 w-4 rounded shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** ContributionsPanel.tsx's RecentActivity card. */
export function RecentActivitySkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
      <SkeletonText variant="label-caps" width="w-32" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <ActivityLineSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

/** One activity-feed line (dot, sentence, relative time) - dashboard + RecentActivity. */
export function ActivityLineSkeleton() {
  return (
    <div className="flex gap-2.5">
      <Skeleton className="mt-1.5 size-1.5 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <SkeletonText width="w-4/5" />
        <SkeletonText variant="mono-sm" width="w-20" className="mt-0.5" />
      </div>
    </div>
  );
}

const CONTRIBUTION_TYPE_COUNT = 10;

/** ContributionsPanel.tsx while the profile itself is loading: type tiles, list, score card + activity. */
export function ContributionsPanelSkeleton() {
  return (
    <SkeletonRegion className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
      <div className="space-y-6 min-w-0">
        <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {Array.from({ length: CONTRIBUTION_TYPE_COUNT }).map((_, index) => (
            <div
              key={index}
              className="flex flex-col items-center gap-0.5 rounded-xl border border-outline-variant px-2 py-3"
            >
              <Skeleton className="h-[18px] w-[18px] rounded" />
              <SkeletonText variant="headline-md" width="w-6" />
              <SkeletonText width="w-14" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <SkeletonText variant="headline-md" width="w-40" />
          <ContributionItemsSkeleton kind="card" />
        </div>
      </div>
      <aside className="space-y-4">
        <div className="bg-primary-container rounded-xl border border-outline-variant p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <SkeletonText variant="label-caps" width="w-16" />
              <SkeletonText variant="display" width="w-16" />
              <SkeletonText width="w-24" />
            </div>
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          </div>
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
        <RecentActivitySkeleton />
      </aside>
    </SkeletonRegion>
  );
}

/**
 * The tab's item list: "card" for articles/questions/answers (KnowledgeCard
 * frame), "row" for courses and engineering items (icon + title row).
 */
export function ContributionItemsSkeleton({ kind, count = 4 }: { kind: "card" | "row"; count?: number }) {
  return (
    <SkeletonRegion className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, index) =>
        kind === "row" ? (
          <div
            key={index}
            className="flex items-center gap-3 bg-surface-container-low border border-outline-variant rounded-xl p-4"
          >
            <Skeleton className="h-5 w-5 rounded-md shrink-0" />
            <SkeletonText width={index % 2 ? "w-1/2" : "w-2/3"} className="flex-1" />
          </div>
        ) : (
          <KnowledgeCardSkeleton key={index} />
        ),
      )}
    </SkeletonRegion>
  );
}
