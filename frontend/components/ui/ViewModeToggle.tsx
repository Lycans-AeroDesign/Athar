"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import { Icon } from "./Icon";

export type ViewMode = "grid" | "table";

// useLayoutEffect warns during SSR; same fallback OrganizationProvider.tsx uses.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Grid/table preference for a list page, remembered per page in localStorage.
 * Read after mount (not as the initial state) so the server render and
 * hydration agree on "grid"; a saved "table" is ignored below Tailwind `md`,
 * where a dense table fits poorly, so mobile always starts on the grid.
 */
export function useViewMode(storageKey: string): [ViewMode, (mode: ViewMode) => void] {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useIsomorphicLayoutEffect(() => {
    const isMobileViewport = window.matchMedia("(max-width: 767px)").matches;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if ((saved === "grid" || saved === "table") && !(isMobileViewport && saved === "table")) {
        setViewMode(saved);
      }
    } catch {
      // Private browsing / storage disabled - keep the default.
    }
  }, [storageKey]);

  function updateViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      // Private browsing / quota exceeded - the choice just won't persist.
    }
  }

  return [viewMode, updateViewMode];
}

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  gridLabel: string;
  tableLabel: string;
}

/** Two-button segmented control with a sliding highlight (Components, Documents). */
export function ViewModeToggle({ value, onChange, gridLabel, tableLabel }: ViewModeToggleProps) {
  const buttonClass = (active: boolean) =>
    `relative z-10 flex h-8 w-8 items-center justify-center rounded-md outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
      active ? "text-on-primary-container" : "text-on-surface-variant hover:text-on-surface"
    }`;

  return (
    <div className="relative flex h-10 items-center gap-1 rounded-lg border border-outline-variant p-1">
      {/* Sliding highlight, not a per-button background swap - a physical
          translate-x, so it needs an rtl: mirror since Arabic visually
          reverses which side "grid" vs "table" sits on. */}
      <div
        aria-hidden
        className={`absolute inset-y-1 start-1 h-8 w-8 rounded-md bg-primary-container transition-transform duration-200 ease-out ${
          value === "table" ? "translate-x-9 rtl:-translate-x-9" : "translate-x-0"
        }`}
      />
      <button
        type="button"
        aria-label={gridLabel}
        aria-pressed={value === "grid"}
        onClick={() => onChange("grid")}
        className={buttonClass(value === "grid")}
      >
        <Icon name="grid_view" size={18} />
      </button>
      <button
        type="button"
        aria-label={tableLabel}
        aria-pressed={value === "table"}
        onClick={() => onChange("table")}
        className={buttonClass(value === "table")}
      >
        <Icon name="table_chart" size={18} />
      </button>
    </div>
  );
}
