import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TOUR_STEP_IDS } from "./tour";

// Reads the actual source text of the two files that place `data-tour`
// targets, rather than importing/rendering the components themselves -
// SideNav.tsx transitively pulls in next-intl's createNavigation
// (next/navigation), which Next's App Router resolves specially and Vitest
// can't outside a real Next build. A plain text search sidesteps that
// entirely and is arguably more faithful to what "hand-sync" actually means
// here: does the id used in tour.ts show up as a real data-tour target
// anywhere (either NAV_ITEMS' dynamic `tourId: "..."` or a literal
// `data-tour="..."` like SideNav's own Settings link and TopBar's search/
// account-menu targets)?
// process.cwd() is the frontend project root under Vitest (matches
// vitest.config.ts, which has no custom `root`).
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
