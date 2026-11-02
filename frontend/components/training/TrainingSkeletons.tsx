import {
  MarkdownEditorSkeleton,
  Skeleton,
  SkeletonBackLink,
  SkeletonButton,
  SkeletonIconButton,
  SkeletonInput,
  SkeletonPill,
  SkeletonRegion,
  SkeletonText,
} from "@/components/ui/Skeleton";

// Skeletons for the training screens; each mirrors the page named in its doc comment.

/** One collapsed CurriculumList module header (`rounded-xl border`, `p-3` button). */
function CurriculumModuleSkeleton({ index }: { index: number }) {
  return (
    <div className="rounded-xl border border-outline-variant overflow-hidden">
      <div className="flex items-center justify-between gap-2.5 p-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Skeleton className="h-5 w-5 rounded-md shrink-0" />
          <SkeletonText width={index % 2 ? "w-1/2" : "w-2/3"} className="flex-1" />
        </div>
        <Skeleton className="h-3 w-8 rounded shrink-0" />
      </div>
    </div>
  );
}

/** training/courses/[id]/page.tsx: 3-column grid, header + description + curriculum, sticky facts card. */
export function CourseDetailSkeleton() {
  return (
    <SkeletonRegion className="space-y-6 max-w-[1200px] mx-auto pb-12">
      <SkeletonBackLink />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SkeletonText variant="label-caps" width="w-16" />
              <SkeletonPill className="w-20" />
              <SkeletonPill className="w-24" />
              <SkeletonPill className="w-20" />
            </div>
            <SkeletonText variant="display" width="w-3/4" />
            <SkeletonText variant="body-lg" lines={2} width="w-full" lastWidth="w-2/3" />
            <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-outline-variant/60">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <SkeletonText width="w-28" />
              </div>
              <SkeletonText variant="mono-sm" width="w-24" />
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant bg-surface-container-low p-5 sm:p-6 space-y-3">
            <SkeletonText variant="body-lg" width="w-40" />
            <SkeletonText lines={4} width="w-full" lastWidth="w-1/2" />
          </div>

          <div className="space-y-4">
            <div>
              <SkeletonText variant="headline-md" width="w-32" />
              <SkeletonText width="w-48" className="mt-0.5" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <CurriculumModuleSkeleton key={index} index={index} />
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl border border-outline-variant bg-surface-container-low shadow-sm overflow-hidden">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="p-5 space-y-5">
              <SkeletonButton className="w-full" />
              <div className="space-y-3 pt-3 border-t border-outline-variant/60">
                <SkeletonText variant="label-caps" width="w-32" />
                <div className="space-y-2.5">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="flex items-center justify-between gap-2">
                      <SkeletonText width="w-24" />
                      <SkeletonText width="w-6" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The lesson column of learn/[lessonId]/page.tsx: breadcrumb, title, content block, text. */
export function LessonBodySkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <SkeletonText variant="label-caps" width="w-48" />
      <div className="space-y-2">
        <SkeletonText variant="display" width="w-2/3" />
        <SkeletonText width="w-1/2" />
      </div>
      <Skeleton className="w-full aspect-video min-h-[320px] rounded-2xl" />
      <SkeletonText lines={3} width="w-full" lastWidth="w-2/3" />
    </SkeletonRegion>
  );
}

/** learn/[lessonId]/page.tsx before the course loads: curriculum sidebar (lg+ only) + lesson column. */
export function CourseLearnSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col lg:flex-row gap-8 items-start w-full">
      <aside className="hidden lg:block w-80 xl:w-[380px] shrink-0 bg-surface-container-low border border-outline-variant rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
        <div className="space-y-2 pb-3 border-b border-outline-variant">
          <Skeleton className="h-3 w-28 rounded my-0.5" />
          <SkeletonText variant="headline-md" width="w-3/4" />
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-16 rounded" />
              <Skeleton className="h-3 w-8 rounded" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <CurriculumModuleSkeleton key={index} index={index} />
          ))}
        </div>
      </aside>
      <div className="flex-1 w-full min-w-0 max-w-5xl">
        <LessonBodySkeleton />
      </div>
    </SkeletonRegion>
  );
}

function LabeledInputSkeleton({ className }: { className: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <SkeletonText variant="label-caps" width="w-20" />
      <SkeletonInput />
    </div>
  );
}

/** training/manage/courses/[id]/page.tsx: header, Curriculum/Settings tabs, then the active tab. */
export function CourseEditorSkeleton({ tab = "curriculum" }: { tab?: "curriculum" | "settings" }) {
  return (
    <SkeletonRegion className="max-w-[800px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonBackLink className="w-44" />
        <div className="flex items-center gap-2">
          <SkeletonPill className="w-20" />
          <SkeletonIconButton />
          <SkeletonIconButton />
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-outline-variant">
        {["w-28", "w-32"].map((width, index) => (
          <div key={index} className="px-4 py-2.5 border-b-2 border-transparent">
            <SkeletonText variant="label-caps" width={width} />
          </div>
        ))}
      </div>

      {tab === "settings" ? (
        <div className="space-y-4 bg-surface-container-low border border-outline-variant rounded-xl p-4 sm:p-6">
          <SkeletonText variant="headline-md" width="w-48" />
          <SkeletonText variant="headline-lg" width="w-2/3" />
          <SkeletonText width="w-1/2" />
          <MarkdownEditorSkeleton />
          <div className="flex flex-wrap gap-3">
            <LabeledInputSkeleton className="w-full sm:w-56" />
            <LabeledInputSkeleton className="w-full sm:w-56" />
            <LabeledInputSkeleton className="w-full sm:w-56" />
          </div>
          <Skeleton className="h-36 w-full sm:w-72 rounded-xl" />
          <div className="pt-2 border-t border-outline-variant">
            <SkeletonButton className="w-20" />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SkeletonText variant="headline-md" width="w-28" />
            <div className="flex items-center gap-2">
              <SkeletonButton className="w-40" />
              <SkeletonButton className="w-32" />
            </div>
          </div>
          {[3, 2].map((lessonCount, moduleIndex) => (
            <div
              key={moduleIndex}
              className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <SkeletonText variant="headline-md" width="w-1/2" />
                  <SkeletonText variant="label-caps" width="w-20" />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <SkeletonIconButton key={index} />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                {Array.from({ length: lessonCount }).map((_, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface">
                    <SkeletonText width={index % 2 ? "w-1/3" : "w-1/2"} className="flex-1" />
                    <div className="flex items-center gap-1 shrink-0">
                      <Skeleton className="h-5 w-5 rounded-md" />
                      <Skeleton className="h-5 w-5 rounded-md" />
                      <Skeleton className="h-5 w-5 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SkeletonRegion>
  );
}

/** training/manage/courses/[id]/lessons/[lessonId]/page.tsx: info card + content editor, objectives, resources. */
export function LessonEditorSkeleton() {
  return (
    <SkeletonRegion className="max-w-[800px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <SkeletonBackLink className="w-36" />
        <SkeletonIconButton />
      </div>

      <div className="space-y-4 bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <SkeletonText variant="headline-lg" width="w-2/3" />
        <SkeletonText width="w-1/2" />
        <div className="flex flex-wrap items-center gap-4">
          <SkeletonInput className="w-48" />
          <LabeledInputSkeleton className="w-40" />
          <div className="pt-6 flex items-center gap-2">
            <Skeleton className="h-6 w-11 rounded-full" />
            <SkeletonText width="w-20" />
          </div>
        </div>
        <div className="space-y-3 p-4 rounded-xl border border-outline-variant bg-surface">
          <SkeletonText variant="label-caps" width="w-28" />
          <SkeletonText width="w-3/4" />
          <div className="flex flex-wrap items-end gap-3">
            <SkeletonInput className="w-40" />
            <SkeletonInput className="flex-1 min-w-[220px]" />
            <SkeletonButton className="w-20" />
          </div>
        </div>
        <MarkdownEditorSkeleton />
        <SkeletonButton className="w-20" />
      </div>

      {[2, 1].map((rows, sectionIndex) => (
        <div key={sectionIndex} className="space-y-3">
          <SkeletonText variant="headline-md" width="w-32" />
          <div className="space-y-1">
            {Array.from({ length: rows }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant"
              >
                <SkeletonText width="w-2/3" className="flex-1" />
                <Skeleton className="h-6 w-6 rounded-md" />
                <Skeleton className="h-6 w-6 rounded-md" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <SkeletonInput className="flex-1" />
            <SkeletonButton className="w-20" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
