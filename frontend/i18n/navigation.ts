import { createNavigation } from "next-intl/navigation";

import { defaultLocale, locales } from "./request";

// Locale-aware Link/useRouter/usePathname - with localePrefix: "always",
// every internal href needs the current locale prefixed onto it
// automatically. Use these instead of next/link and next/navigation
// anywhere inside app/[locale]/.
export const { Link, useRouter, usePathname, redirect, getPathname } = createNavigation({
  locales,
  defaultLocale,
  localePrefix: "always",
});
