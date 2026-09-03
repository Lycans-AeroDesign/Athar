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

/** `t` is a next-intl translate function already scoped to the `tour` namespace
 * (see ProductTourAutostart.tsx/TopBar.tsx) - kept as a plain function param
 * rather than importing useTranslations here so this module stays free of any
 * React/hook dependency and can be called from a plain event handler. */
export function runProductTour(t: ReturnType<typeof useTranslations>, onFinish: () => void): void {
  // Cast needed since `t`'s key type is narrowed to the `tour` namespace's own
  // literal keys, which TS can't statically verify against a dynamically-
  // built template string like this.
  const key = (k: string) => t(k as Parameters<typeof t>[0]);

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
    onFinish();
    return;
  }

  // A plain, unanchored opener (driver.js centers a step with no `element`)
  // rather than jumping straight into spotlighting the sidebar - gives the
  // walkthrough a clear start instead of appearing mid-explanation.
  steps.unshift({ popover: { title: key("welcomeTitle"), description: key("welcomeDescription") } });

  const driverObj = driver({
    showProgress: true,
    allowClose: true,
    nextBtnText: t("next"),
    prevBtnText: t("previous"),
    doneBtnText: t("done"),
    steps,
    // Fires on both "Done" and clicking outside/Escape - either way, this
    // specific viewer has now seen it, so it must not pop up again on their
    // next login (see accounts.User.preferences.has_completed_tour).
    onDestroyed: onFinish,
  });

  driverObj.drive();
}
