import { getRequestConfig } from "next-intl/server";

// To add a new language: drop a messages/<code>.json file next to en.json
// (copy en.json as a starting point), then add the code here with its
// direction and display name. See README.md "Adding a new language".
export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];

export type TextDirection = "ltr" | "rtl";

export const localeDirections: Record<Locale, TextDirection> = {
  en: "ltr",
  ar: "rtl",
};

// Shown in Settings > General > Default Language - this list IS the set of
// available translations, not a separate hardcoded catalogue.
export const localeNames: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
};

export const localePrefix = "always";
export const defaultLocale: Locale = "en";

export default getRequestConfig(async ({ requestLocale }) => {
  // requestLocale is a Promise in next-intl v4+
  const locale = await requestLocale;

  // Validate and fallback to 'en' if invalid
  const resolvedLocale =
    locale && locales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;

  const messages = await import(`./messages/${resolvedLocale}.json`);
  return {
    locale: resolvedLocale,
    messages: messages.default,
  };
});
