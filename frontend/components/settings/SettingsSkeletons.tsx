import {
  MarkdownEditorSkeleton,
  Skeleton,
  SkeletonButton,
  SkeletonInput,
  SkeletonPillSm,
  SkeletonRegion,
  SkeletonText,
} from "@/components/ui/Skeleton";

// Skeletons for the settings sections that load before rendering a form;
// each mirrors the form component named in its doc comment.

function CardHeading() {
  return (
    <div>
      <SkeletonText variant="headline-md" width="w-40" />
      <SkeletonText width="w-3/4" className="mt-1" />
    </div>
  );
}

function ColorFieldSkeleton() {
  return (
    <div className="space-y-2">
      <SkeletonText variant="label-caps" width="w-24" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
        <SkeletonInput className="flex-1" />
      </div>
    </div>
  );
}

/** IdentitySettingsForm.tsx inside SettingsWithPreview (form + 20rem live preview). */
export function IdentitySettingsSkeleton() {
  return (
    <SkeletonRegion className="@container">
      <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
        <div className="space-y-6">
          {[0, 1].map((index) => (
            <div key={index} className="bg-surface rounded-xl border border-outline-variant p-6 space-y-2">
              <SkeletonText variant="label-caps" width="w-32" />
              <SkeletonInput />
            </div>
          ))}
          <div className="grid grid-cols-1 @md:grid-cols-2 gap-6">
            {["h-36 w-36", "h-28 w-28"].map((size, index) => (
              <div key={index} className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
                <CardHeading />
                <Skeleton className={`${size} rounded-xl`} />
              </div>
            ))}
          </div>
          <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
            <CardHeading />
            {[0, 1].map((theme) => (
              <div key={theme} className="space-y-3">
                <SkeletonText variant="label-caps" width="w-24" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ColorFieldSkeleton />
                  <ColorFieldSkeleton />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-4">
              <SkeletonButton className="w-24" />
              <SkeletonButton className="w-20" />
            </div>
          </div>
        </div>
        <aside className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
          <CardHeading />
          <div className="grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-1 gap-4">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </aside>
      </div>
    </SkeletonRegion>
  );
}

/** FeaturesSettingsForm.tsx: one card with heading, toggles, save row. */
export function FeaturesSettingsSkeleton({ toggles = 1 }: { toggles?: number }) {
  return (
    <SkeletonRegion className="max-w-2xl bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
      <CardHeading />
      {Array.from({ length: toggles }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-6 w-11 rounded-full shrink-0" />
          <SkeletonText width="w-48" />
        </div>
      ))}
      <div className="flex items-center gap-4">
        <SkeletonButton className="w-24" />
        <SkeletonButton className="w-20" />
      </div>
    </SkeletonRegion>
  );
}

/** PoliciesSettingsForm.tsx: intro line + one PolicyCard per policy kind. */
export function PoliciesSettingsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <SkeletonRegion className="space-y-6 max-w-4xl">
      <SkeletonText width="w-2/3" />
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardHeading />
            {index === 0 && <SkeletonPillSm className="w-32" />}
          </div>
          <SkeletonInput />
          <MarkdownEditorSkeleton />
          <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
            <SkeletonButton className="w-full sm:w-24" />
            <SkeletonButton className="w-full sm:w-24" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
