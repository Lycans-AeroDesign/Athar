"use client";

import "driver.js/dist/driver.css";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { updateMe } from "@/lib/api/accounts";
import { useAuth } from "@/lib/auth/AuthProvider";
import { runProductTour } from "@/lib/onboarding/tour";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

/** Mounted once in the protected layout - renders nothing, just watches for
 * "this org has the tour on, and this viewer hasn't seen it yet" and starts
 * it automatically. TopBar.tsx's "Take a tour" menu item calls
 * runProductTour() directly for a manual replay, bypassing this component
 * entirely (it doesn't re-check has_completed_tour, since replaying is an
 * explicit request). */
export function ProductTourAutostart() {
  const t = useTranslations("tour");
  const { user, updateUser } = useAuth();
  const { settings } = useOrganization();
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    if (!settings?.product_tour_enabled) return;
    if (!user || user.preferences.has_completed_tour) return;

    // A short delay so the tour starts after the shell has actually painted
    // (data-tour targets need real layout/position) rather than racing the
    // first render. `hasStarted` is only flipped once the timeout actually
    // fires, not when it's merely scheduled - React's Strict Mode runs this
    // effect's cleanup then re-invokes it once in development, and flipping
    // the ref up front would have let that first, cancelled timeout "use up"
    // the one-shot guard while never actually starting the tour.
    const timeout = setTimeout(() => {
      if (hasStarted.current) return;
      hasStarted.current = true;
      runProductTour(t, () => {
        updateMe({ preferences: { ...user.preferences, has_completed_tour: true } }).then(updateUser);
      });
    }, 500);

    return () => clearTimeout(timeout);
  }, [settings?.product_tour_enabled, user, updateUser, t]);

  return null;
}
