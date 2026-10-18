import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TOUR_STEP_IDS } from "./tour";

// Reads the source text of the files that place `data-tour` targets instead of rendering them:
// SideNav.tsx pulls in next-intl's createNavigation (next/navigation), which Vitest can't resolve
// outside a real Next build. A text search also checks what matters: that each id in tour.ts shows
// up as a real data-tour target (NAV_ITEMS' `tourId: "..."` or a literal `data-tour="..."`).
// process.cwd() is the frontend root under Vitest (vitest.config.ts has no custom `root`).
const sideNavSource = readFileSync(join(process.cwd(), "components/layout/SideNav.tsx"), "utf-8");
const topBarSource = readFileSync(join(process.cwd(), "components/layout/TopBar.tsx"), "utf-8");
const combinedSource = sideNavSource + topBarSource;

describe("product tour / sidebar+topbar data-tour sync", () => {
  it.each(TOUR_STEP_IDS)("'%s' has a real data-tour target", (id) => {
    const hasStaticAttribute = combinedSource.includes(`data-tour="${id}"`);
    const hasDynamicTourId = combinedSource.includes(`tourId: "${id}"`);
    expect(hasStaticAttribute || hasDynamicTourId).toBe(true);
  });
});
