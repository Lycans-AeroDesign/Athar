import { DirectionProvider } from "@radix-ui/react-direction";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { BrandColorSync } from "@/components/theme/BrandColorSync";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { OrganizationProvider } from "@/lib/organization/OrganizationProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { isThemePreference, THEME_COOKIE_NAME } from "@/lib/theme/theme";
import { localeDirections, locales, type Locale } from "@/i18n/request";
import "./globals.css";

// Self-hosted variable-font files (see frontend/app/fonts/) instead of
// next/font/google - that mechanism needs a live fetch to
// fonts.googleapis.com at compile time, which silently falls back to a
// system font (different letterforms/metrics, not just a missing weight)
// wherever that host isn't reachable - sandboxed CI/build environments
// included. Local files have no such dependency. Same --font-inter/
// --font-jetbrains-mono variable names and weight ranges as before, so
// nothing downstream (globals.css, every Tailwind font-* class) changes.
const inter = localFont({
  src: "../fonts/Inter-VariableFont_opsz_wght.ttf",
  variable: "--font-inter",
  weight: "100 900",
});

const jetbrainsMono = localFont({
  src: "../fonts/JetBrainsMono-VariableFont_wght.ttf",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Kept generic - the actual org name is applied client-side once fetched
// (see lib/organization/OrganizationProvider.tsx), since resolving it here
// would require a server-side fetch to the backend using a container-internal
// URL that differs from NEXT_PUBLIC_API_URL (which is meant for the browser).
export const metadata: Metadata = {
  title: "Athar",
  description: "Engineering Knowledge System",
};

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const theme = isThemePreference(cookieValue) ? cookieValue : "system";
  // Setting data-theme server-side (from the cookie) means the first paint
  // already has the right theme - no client-side flash-of-wrong-theme fix needed.
  const dataTheme = theme === "system" ? undefined : theme;

  return (
    <html
      lang={locale}
      dir={localeDirections[locale as Locale]}
      data-theme={dataTheme}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body-md text-body-md">
        <NextIntlClientProvider messages={messages}>
          {/* Radix primitives (DropdownMenu, Dialog, ...) default their own
              internal direction to ltr unless told otherwise - they don't
              read the <html dir> attribute themselves. Without this, submenu
              open-side, alignment keywords, and arrow-key nav inside those
              components would stay LTR even on an RTL page. */}
          <DirectionProvider dir={localeDirections[locale as Locale]}>
            <ThemeProvider initialTheme={theme}>
              <AuthProvider>
                <OrganizationProvider>
                  <BrandColorSync />
                  {children}
                </OrganizationProvider>
              </AuthProvider>
            </ThemeProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
