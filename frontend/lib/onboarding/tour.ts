import type { useTranslations } from "next-intl";

import { driver, type DriveStep } from "driver.js";

/** One entry per `data-tour="<id>"` in SideNav.tsx/TopBar.tsx; add a step here and tag its target
 * the same way. Order matches the sidebar top to bottom. Content-type steps explain what belongs
 * in each section (e.g. a Failure report vs a SOP), not just the nav item. */
// Exported so tour.test.ts can assert every "nav-*" id has a matching `tourId` in SideNav's
// NAV_ITEMS (the two lists have no shared source of truth).
export const TOUR_STEP_IDS = [
  "nav-dashboard",
  "nav-knowledge",
  "nav-projects",
  "nav-components",
  "nav-sops",
  "nav-failures",
  "nav-tests",
  "nav-documents",
  "nav-training",
  "nav-bookmarks",
  "global-search",
  "account-menu",
  "nav-settings",
] as const;

// Ids in this range live in SideNav, an off-canvas drawer below `lg` that the tour must open
// itself or the popover points at nothing. TopBar's ids are always on-screen, hence the "nav-"
// prefix convention.
function needsMobileDrawer(step: DriveStep): boolean {
  return typeof step.element === "string" && /data-tour="nav-/.test(step.element);
}

export interface MobileNavControl {
  openMobileNav: () => void;
  closeMobileNav: () => void;
}

/** `t` is a next-intl translator scoped to the `tour` namespace (see ProductTourAutostart.tsx/
 * TopBar.tsx), passed as a param to keep this module free of React hooks. */
export function runProductTour(
  t: ReturnType<typeof useTranslations>,
  onFinish: () => void,
  { openMobileNav, closeMobileNav }: MobileNavControl,
): void {
  // Cast: `t`'s key type is narrowed to the `tour` namespace's literals, which TS can't check
  // against a built template string.
  const key = (k: string) => t(k as Parameters<typeof t>[0]);

  // Open the drawer up front so nav-* targets exist on mobile (the filter only checks the DOM,
  // not visibility). No-op at `lg`+; closed again once the tour moves past the sidebar steps.
  openMobileNav();

  const steps: DriveStep[] = TOUR_STEP_IDS.filter((id) => document.querySelector(`[data-tour="${id}"]`)).map(
    (id) => ({
      element: `[data-tour="${id}"]`,
      popover: {
        title: key(`${id}Title`),
        description: key(`${id}Description`),
      },
    }),
  );

  // Targets are always in the DOM once logged in, so an empty result means the shell hasn't
  // mounted yet; skip silently rather than open an empty overlay.
  if (steps.length === 0) {
    closeMobileNav();
    onFinish();
    return;
  }

  // Unanchored opener (driver.js centers a step with no `element`) so the tour has a clear start.
  steps.unshift({ popover: { title: key("welcomeTitle"), description: key("welcomeDescription") } });

  // `driverObj` is referenced in the hooks below before this declaration finishes; safe because
  // hooks only run after `driver(...)` has returned.
  const driverObj = driver({
    showProgress: true,
    allowClose: true,
    nextBtnText: t("next"),
    prevBtnText: t("previous"),
    doneBtnText: t("done"),
    steps,
    // Opens/closes the SideNav drawer as the tour crosses sidebar and topbar/modal steps. The
    // 200ms CSS transition can leave driver.js measuring mid-slide, so refresh() re-measures
    // after it; harmless when the drawer is already in the right state.
    onHighlightStarted: (_element, step) => {
      if (needsMobileDrawer(step)) {
        openMobileNav();
        setTimeout(() => driverObj.refresh(), 250);
      } else {
        closeMobileNav();
      }
    },
    // Fires on Done and on outside click/Escape: either way this viewer has seen the tour
    // (accounts.User.preferences.has_completed_tour).
    onDestroyed: () => {
      closeMobileNav();
      onFinish();
    },
  });

  driverObj.drive();
}
