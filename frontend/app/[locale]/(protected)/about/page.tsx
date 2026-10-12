import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

// About moved into the Help page as its own tab - kept as a redirect so old
// links and bookmarks still land somewhere sensible.
export default async function AboutPage() {
  redirect({ href: "/help?tab=about", locale: await getLocale() });
}
