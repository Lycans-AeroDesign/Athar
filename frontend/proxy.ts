import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { defaultLocale, localePrefix, locales } from "@/i18n/request";

// Must match the backend's JWT_REFRESH_COOKIE_NAME (see backend/.env.example).
// Documented cross-repo naming contract - not worth a shared env var for one string.
const REFRESH_COOKIE_NAME = "refresh_token";

const PUBLIC_PATHS = ["/login", "/register"];

const handleIntl = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix,
});

const LOCALE_PATTERN = locales.join("|");

function stripLocale(pathname: string): string {
  const match = pathname.match(new RegExp(`^/(?:${LOCALE_PATTERN})(/.*)?$`));
  if (!match) return pathname;
  return match[1] || "/";
}

function currentLocale(pathname: string): string {
  const match = pathname.match(new RegExp(`^/(${LOCALE_PATTERN})(?:/|$)`));
  return match?.[1] ?? defaultLocale;
}

// UX routing only: this proxy can see cookies but has no access to the
// browser's in-memory access token, so it never attempts a refresh itself.
// Django re-authenticates and re-authorizes every request regardless - this
// only avoids rendering a page that would immediately fail with no session.
export function proxy(request: NextRequest) {
  const pathWithoutLocale = stripLocale(request.nextUrl.pathname);
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathWithoutLocale === path || pathWithoutLocale.startsWith(`${path}/`),
  );
  const hasRefreshCookie = request.cookies.has(REFRESH_COOKIE_NAME);

  if (!isPublicPath && !hasRefreshCookie) {
    const locale = currentLocale(request.nextUrl.pathname);
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("next", pathWithoutLocale);
    return NextResponse.redirect(loginUrl);
  }

  return handleIntl(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
