import type { ReactNode } from "react";

// Loading placeholders. The rule for every skeleton in this codebase: it must
// mirror the real markup it stands in for - same wrapper classes, padding,
// gaps, grid breakpoints and line heights - so nothing shifts when the data
// arrives. Generic shapes live here; anything specific to one component lives
// next to that component (e.g. CourseCardSkeleton in CourseCard.tsx) so an
// edit to the real thing has its skeleton right beside it.

interface SkeletonProps {
  className?: string;
}

/** Base pulsing placeholder block using semantic surface tokens. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-surface-variant/70 ${className}`} />;
}

/** Wrapper for a whole loading region - one `role="status"` per region rather than per block. */
export function SkeletonRegion({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      {children}
    </div>
  );
}

// Line box (= the type token's line-height, see globals.css) and the bar drawn
// inside it. Using the real line box keeps heights identical to the text.
const LINE_BOX = {
  display: "h-11",
  "headline-lg": "h-9",
  "headline-md": "h-7",
  "body-lg": "h-[26px]",
  "body-md": "h-5",
  "label-caps": "h-4",
  "mono-sm": "h-[18px]",
} as const;
const LINE_BAR = {
  display: "h-8",
  "headline-lg": "h-6",
  "headline-md": "h-5",
  "body-lg": "h-4",
  "body-md": "h-3.5",
  "label-caps": "h-3",
  "mono-sm": "h-3",
} as const;

export type SkeletonTextVariant = keyof typeof LINE_BOX;

interface SkeletonTextProps {
  variant?: SkeletonTextVariant;
  /** Width of the bar (Tailwind width class). Applies to every line but the last of a multi-line block. */
  width?: string;
  lines?: number;
  /** Width of the last line when `lines > 1`. */
  lastWidth?: string;
  className?: string;
}

/** One or more text lines at the exact height of the given type token. */
export function SkeletonText({
  variant = "body-md",
  width = "w-full",
  lines = 1,
  lastWidth = "w-2/3",
  className = "",
}: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={className}>
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className={`${LINE_BOX[variant]} flex items-center`}>
          <Skeleton
            className={`${LINE_BAR[variant]} rounded-md ${lines > 1 && index === lines - 1 ? lastWidth : width}`}
          />
        </div>
      ))}
    </div>
  );
}

/** A label-caps pill (`px-2.5 py-1 rounded-full`, e.g. StatusPill) - 24px tall. */
export function SkeletonPill({ className = "w-20" }: SkeletonProps) {
  return <Skeleton className={`h-6 rounded-full shrink-0 ${className}`} />;
}

/** A small label-caps pill (`px-2 py-0.5 rounded-full`) - 20px tall. */
export function SkeletonPillSm({ className = "w-16" }: SkeletonProps) {
  return <Skeleton className={`h-5 rounded-full shrink-0 ${className}`} />;
}

/** A md <Button> (with an icon) - 34px tall. */
export function SkeletonButton({ className = "w-28" }: SkeletonProps) {
  return <Skeleton className={`h-[34px] rounded-lg shrink-0 ${className}`} />;
}

/** An <IconButton> / BookmarkButton - 34-36px square. */
export function SkeletonIconButton() {
  return <Skeleton className="h-9 w-9 rounded-lg shrink-0" />;
}

/** A text input / Combobox trigger (`px-4 py-2` body-md + border) - 38px tall. */
export function SkeletonInput({ className = "w-full" }: SkeletonProps) {
  return <Skeleton className={`h-[38px] rounded-lg ${className}`} />;
}

/** The back link every detail/editor page starts with (label-caps + 16px icon). */
export function SkeletonBackLink({ className = "w-32" }: SkeletonProps) {
  return <SkeletonText variant="label-caps" width={className} />;
}

/** MarkdownEditor shell: bordered box, toolbar row, then the 400px min-height body. */
export function MarkdownEditorSkeleton() {
  return (
    <div className="rounded-xl border border-outline-variant overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-outline-variant bg-surface-container-low">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-7 rounded-md" />
        ))}
        <div className="ms-auto flex gap-1">
          <Skeleton className="h-6 w-16 rounded-lg" />
          <Skeleton className="h-6 w-16 rounded-lg" />
        </div>
      </div>
      <div className="min-h-[400px] p-4 space-y-2">
        <SkeletonText lines={4} width="w-11/12" lastWidth="w-1/2" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables

export type TableSkeletonCell = "text" | "title" | "pill" | "avatar-text" | "two-line" | "actions" | "thumb";

interface TableSkeletonProps {
  rows?: number;
  /** One entry per real column, describing what the cell holds. */
  columns: TableSkeletonCell[];
  /**
   * "boxed" mirrors components/ui/DataTable.tsx (own rounded border, px-4 py-3
   * cells). "flush" mirrors the settings/platform tables that sit edge-to-edge
   * inside an already-bordered card (border-t rows, px-6 py-2/2.5 cells).
   */
  variant?: "boxed" | "flush";
}

function TableSkeletonCellContent({ kind }: { kind: TableSkeletonCell }) {
  switch (kind) {
    case "title":
      return <SkeletonText width="w-4/5" />;
    case "pill":
      return <SkeletonPill className="w-20" />;
    case "two-line":
      return (
        <div>
          <SkeletonText width="w-3/4" />
          <SkeletonText variant="mono-sm" width="w-1/2" />
        </div>
      );
    case "avatar-text":
      return (
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <SkeletonText width="w-2/3" className="flex-1" />
        </div>
      );
    case "thumb":
      return <Skeleton className="h-9 w-9 rounded-lg" />;
    case "actions":
      return (
        <div className="flex justify-end gap-2">
          <SkeletonButton className="w-20" />
        </div>
      );
    default:
      return <SkeletonText width="w-2/3" />;
  }
}

export function TableSkeleton({ rows = 6, columns, variant = "boxed" }: TableSkeletonProps) {
  const flush = variant === "flush";
  return (
    <div
      role="status"
      aria-busy="true"
      className={flush ? "overflow-x-auto" : "overflow-x-auto rounded-xl border border-outline-variant"}
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className={flush ? "border-t border-outline-variant" : "border-b border-outline-variant bg-surface-container-low"}>
            {columns.map((_, index) => (
              <th key={index} className={flush ? "px-6 py-2" : "px-4 py-3"}>
                <SkeletonText variant="label-caps" width="w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr
              key={rowIndex}
              className={flush ? "border-t border-outline-variant" : "border-b border-outline-variant last:border-0"}
            >
              {columns.map((kind, colIndex) => (
                <td key={colIndex} className={flush ? "px-6 py-2.5" : "px-4 py-3"}>
                  <TableSkeletonCellContent kind={kind} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists

interface SettingsListSkeletonProps {
  rows?: number;
  /** Second, muted line under the title (description / roles / uses). */
  twoLine?: boolean;
  /** Pill right after the title (e.g. a status). */
  titlePill?: boolean;
  /** What sits on the right of each row. */
  trailing?: "icon-buttons" | "count-and-icons" | "button" | "none";
}

/**
 * The compact `px-3 py-2 rounded-lg bg-surface-container` rows (space-y-1)
 * every settings list uses - Users, Invitations, Categories, Backups, Course
 * categories, Inventory categories/locations.
 */
export function SettingsListSkeleton({
  rows = 4,
  twoLine = true,
  titlePill = false,
  trailing = "icon-buttons",
}: SettingsListSkeletonProps) {
  return (
    <SkeletonRegion className="space-y-1">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-container"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SkeletonText width="w-48 max-w-full" />
              {titlePill && <SkeletonPillSm />}
            </div>
            {twoLine && <SkeletonText width="w-64 max-w-full" />}
          </div>
          {trailing !== "none" && (
            <div className="flex items-center gap-3 shrink-0">
              {trailing === "count-and-icons" && <SkeletonText variant="mono-sm" width="w-20" />}
              {trailing === "button" ? (
                <SkeletonButton className="w-24" />
              ) : (
                <>
                  <Skeleton className="h-5 w-5 rounded-md" />
                  <Skeleton className="h-5 w-5 rounded-md" />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Settings "pick a row" menu list (Roles): `px-3 py-2 rounded-lg` buttons, space-y-1, no fill. */
export function MenuListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <SkeletonRegion className="space-y-1">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center justify-between px-3 py-2 rounded-lg">
          <SkeletonText width={index % 2 ? "w-24" : "w-32"} />
          {index === 0 && <SkeletonPillSm />}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Icon + one-line title rows in `bg-surface-container-low` bordered cards (Bookmarks, contribution rows). */
export function IconRowListSkeleton({
  rows = 5,
  gap = "space-y-2",
  trailingIcon = false,
}: {
  rows?: number;
  gap?: string;
  trailingIcon?: boolean;
}) {
  return (
    <SkeletonRegion className={gap}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 bg-surface-container-low border border-outline-variant rounded-xl p-4"
        >
          <Skeleton className="h-5 w-5 rounded-md shrink-0" />
          <SkeletonText width={index % 2 ? "w-1/2" : "w-2/3"} className="flex-1" />
          {trailingIcon && <Skeleton className="h-4 w-4 rounded shrink-0" />}
        </div>
      ))}
    </SkeletonRegion>
  );
}

// ---------------------------------------------------------------------------
// Pages

interface DetailPageSkeletonProps {
  /** RelatedContent sidebar (`lg:w-80`) - every engineering + knowledge detail page has one. */
  withSidebar?: boolean;
  /** Article pages' table-of-contents column on the left (`hidden lg:block w-56`). */
  withToc?: boolean;
  /**
   * Header frame: a coloured top rule (`border-t-4`, failures use error) or,
   * for questions, a bottom underline (`pb-4 border-b`).
   */
  accent?: "primary" | "error" | "underline";
  /** Title type token - questions use headline-lg, everything else display. */
  titleVariant?: "display" | "headline-lg";
  /** Number of pills in the top-left of the header (status, type badge...). */
  headerPills?: number;
  /** Number of icon buttons in the top-right of the header (bookmark, share, edit, delete...). */
  headerActions?: number;
  /** A row of tag chips under the title. */
  withTags?: boolean;
  /** "markdown" = free-form body; "sections" = several h2 + paragraph sections (failures, tests). */
  body?: "markdown" | "sections";
}

/** Matches the engineering + knowledge detail layout (projects/[id]/page.tsx and siblings). */
export function DetailPageSkeleton({
  withSidebar = true,
  withToc = false,
  accent = "primary",
  titleVariant = "display",
  headerPills = 1,
  headerActions = 3,
  withTags = true,
  body = "markdown",
}: DetailPageSkeletonProps) {
  return (
    <SkeletonRegion className="flex flex-col lg:flex-row gap-8 items-start">
      {withToc && (
        <aside className="hidden lg:block w-56 shrink-0 space-y-3">
          <SkeletonText variant="label-caps" width="w-28" />
          <div className="space-y-2 border-s border-outline-variant ps-3">
            {["w-36", "w-28", "w-32", "w-24"].map((width, index) => (
              <SkeletonText key={index} width={width} />
            ))}
          </div>
        </aside>
      )}

      <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
        <SkeletonBackLink />

        <div
          className={
            accent === "underline"
              ? "pb-4 border-b border-outline-variant space-y-3"
              : `border-t-4 ${accent === "error" ? "border-error/40" : "border-primary/40"} rounded-t-xl bg-surface pt-6 space-y-3`
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {Array.from({ length: headerPills }).map((_, index) => (
                <SkeletonPill key={index} className={index === 0 ? "w-24" : "w-16"} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {Array.from({ length: headerActions }).map((_, index) => (
                <SkeletonIconButton key={index} />
              ))}
            </div>
          </div>
          <SkeletonText variant={titleVariant} width="w-3/4" />
          {withTags && (
            <div className="flex flex-wrap gap-2">
              <SkeletonPill className="w-16" />
              <SkeletonPill className="w-20" />
              <SkeletonPill className="w-14" />
            </div>
          )}
          <SkeletonText variant="mono-sm" width="w-40" />
        </div>

        {body === "sections" ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <div className="mb-2 border-b border-outline-variant pb-1">
                  <SkeletonText variant="headline-md" width="w-40" />
                </div>
                <SkeletonText lines={2} width="w-full" lastWidth="w-3/5" />
              </div>
            ))}
          </div>
        ) : (
          <SkeletonText lines={5} width="w-full" lastWidth="w-3/5" />
        )}
      </div>

      {withSidebar && <RelatedContentSkeleton />}
    </SkeletonRegion>
  );
}

/** components/knowledge/RelatedContent.tsx's aside. */
export function RelatedContentSkeleton() {
  return (
    <aside className="w-full lg:w-80 shrink-0 bg-surface-container-low border border-outline-variant rounded-xl self-start">
      <div className="flex items-center justify-between gap-2 p-4 border-b border-outline-variant bg-surface-container-high rounded-t-xl">
        <SkeletonText variant="label-caps" width="w-24" />
        <Skeleton className="h-[18px] w-[18px] rounded" />
      </div>
      <div className="flex flex-col p-4 gap-5">
        {[3, 2].map((count, groupIndex) => (
          <div key={groupIndex}>
            <SkeletonText variant="label-caps" width="w-20" className="mb-2" />
            <div className="flex flex-col gap-0.5">
              {Array.from({ length: count }).map((_, index) => (
                <div key={index} className="flex items-start gap-2 p-2">
                  <Skeleton className="h-4 w-4 rounded shrink-0 mt-0.5" />
                  <SkeletonText width={index % 2 ? "w-2/3" : "w-4/5"} className="flex-1" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

interface EditorPageSkeletonProps {
  /**
   * Field block under the title input, matching the editor:
   * "inline" - TagInput + 2 Comboboxes in one wrapping row (Project, Article, Question, SOP).
   * "grid"   - stacked 2-column input grids (Failure, Test, Document, Component).
   */
  fields?: "inline" | "grid";
  /** Number of 2-column grid rows when `fields="grid"`. */
  gridRows?: number;
  /** Number of MarkdownEditors (Failures/Tests have one per section). */
  editors?: number;
}

/**
 * Edit pages: `max-w-[800px] mx-auto space-y-4` wrapper with back link, then
 * the shared editor shape - borderless headline-lg title input + fields in a
 * `border-b pb-4` block, MarkdownEditor(s), left-aligned Save button.
 */
export function EditorPageSkeleton({ fields = "inline", gridRows = 3, editors = 1 }: EditorPageSkeletonProps) {
  return (
    <SkeletonRegion className="max-w-[800px] mx-auto space-y-4">
      <SkeletonBackLink />
      <div className="space-y-4 max-w-[800px] mx-auto">
        <div className="space-y-4 border-b border-outline-variant pb-4">
          <SkeletonText variant="headline-lg" width="w-2/3" />
          {fields === "inline" ? (
            <div className="flex flex-wrap gap-3 items-center">
              <Skeleton className="h-[38px] flex-1 min-w-[200px] rounded-xl" />
              <SkeletonInput className="w-48" />
              <SkeletonInput className="w-56" />
            </div>
          ) : (
            Array.from({ length: gridRows }).map((_, index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SkeletonInput />
                <SkeletonInput />
              </div>
            ))
          )}
        </div>
        {Array.from({ length: editors }).map((_, index) => (
          <MarkdownEditorSkeleton key={index} />
        ))}
        <div className="flex items-center gap-3">
          <SkeletonButton className="w-20" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * Route-level fallback (app/[locale]/(protected)/loading.tsx) shown for every
 * protected route while its JS chunk loads. It can't know which page is
 * coming, so it draws only what every page shares - a header row - instead of
 * a card grid that would be wrong for detail, editor and settings pages.
 */
export function PageShellSkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <SkeletonText variant="display" width="w-56" />
    </SkeletonRegion>
  );
}
