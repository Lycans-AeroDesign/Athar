import type { useTranslations } from "next-intl";

import { driver, type DriveStep } from "driver.js";

/** One entry per `data-tour="<id>"` attribute placed in SideNav.tsx/TopBar.tsx -
 * add a new step here and tag its target element the same way. Order here is
 * the order the tour walks in, matching the sidebar's own top-to-bottom
 * layout so the walkthrough reads the same way the nav does. Each of the
 * content-type steps (nav-projects..nav-documents) explains what actually
 * belongs in that section, not just "here's the nav item" - that's the
 * point of the tour for a new member who doesn't yet know the difference
 * between e.g. a Failure report and a SOP. */
const TOUR_STEP_IDS = [
  "nav-dashboard",
  "nav-knowledge",
  "nav-projects",
  "nav-components",
  "nav-sops",
  "nav-failures",
  "nav-tests",
  "nav-documents",
  "nav-bookmarks",
  "global-search",
  "account-menu",
  "nav-settings",
] as const;

// Every id in this range lives in SideNav.tsx, which below the `lg` breakpoint
// is an off-canvas drawer translated fully off-screen unless explicitly
// opened (see (protected)/layout.tsx's mobileNavOpen) - none of it is a
// "hidden" state driver.js's own scroll-into-view can fix, so the tour has to
// drive that drawer itself for these steps or a mobile viewer would see the
// popover pointing at nothing. TopBar.tsx's own ids (global-search,
// account-menu) are always on-screen regardless of the drawer, hence the
// "nav-" prefix convention below rather than listing ids explicitly.
function needsMobileDrawer(step: DriveStep): boolean {
  return typeof step.element === "string" && /data-tour="nav-/.test(step.element);
}

export interface MobileNavControl {
  openMobileNav: () => void;
  closeMobileNav: () => void;
}

/** `t` is a next-intl translate function already scoped to the `tour` namespace
 * (see ProductTourAutostart.tsx/TopBar.tsx) - kept as a plain function param
 * rather than importing useTranslations here so this module stays free of any
 * React/hook dependency and can be called from a plain event handler. */
export function runProductTour(
  t: ReturnType<typeof useTranslations>,
  onFinish: () => void,
  { openMobileNav, closeMobileNav }: MobileNavControl,
): void {
  // Cast needed since `t`'s key type is narrowed to the `tour` namespace's own
  // literal keys, which TS can't statically verify against a dynamically-
  // built template string like this.
  const key = (k: string) => t(k as Parameters<typeof t>[0]);

  // The drawer needs to already be open for this filter to find nav-* targets
  // on a mobile viewport (they're only ever `querySelector`-able once
  // rendered, off-canvas or not - this just checks the DOM exists, not
  // visibility), so open it up front; it's a no-op above `lg` and gets closed
  // again below once the tour moves past the sidebar steps.
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

  // Every target is nav chrome that's always in the DOM once logged in - an
  // empty result means the tour was triggered before the shell finished
  // mounting, not a real "nothing to show" case, so just skip silently
  // rather than opening an empty overlay.
  if (steps.length === 0) {
    closeMobileNav();
    onFinish();
    return;
  }

  // A plain, unanchored opener (driver.js centers a step with no `element`)
  // rather than jumping straight into spotlighting the sidebar - gives the
  // walkthrough a clear start instead of appearing mid-explanation.
  steps.unshift({ popover: { title: key("welcomeTitle"), description: key("welcomeDescription") } });

  // The config below references `driverObj` (to call `.refresh()` after
  // toggling the drawer) before this declaration finishes - safe since that
  // reference is only ever read from inside a hook, invoked well after
  // `driver(...)` has returned and this const is fully assigned.
  const driverObj = driver({
    showProgress: true,
    allowClose: true,
    nextBtnText: t("next"),
    prevBtnText: t("previous"),
    doneBtnText: t("done"),
    steps,
    // Opens/closes the off-canvas SideNav drawer as the tour crosses between
    // sidebar steps and topbar-or-modal ones (see needsMobileDrawer above).
    // Toggling `open` kicks off a 200ms CSS transition (SideNav.tsx), so
    // driver.js's own position measurement - taken right after this hook
    // returns - can catch the drawer mid-slide on a mobile viewport; the
    // refresh() below re-measures once that transition has actually
    // finished. Harmless to call every time, including when the drawer was
    // already in the right state (no transition fires, refresh is a no-op
    // reposition onto an unchanged layout).
    onHighlightStarted: (_element, step) => {
      if (needsMobileDrawer(step)) {
        openMobileNav();
        setTimeout(() => driverObj.refresh(), 250);
      } else {
        closeMobileNav();
      }
    },
    // Fires on both "Done" and clicking outside/Escape - either way, this
    // specific viewer has now seen it, so it must not pop up again on their
    // next login (see accounts.User.preferences.has_completed_tour).
    onDestroyed: () => {
      closeMobileNav();
      onFinish();
    },
  });

  driverObj.drive();
}
