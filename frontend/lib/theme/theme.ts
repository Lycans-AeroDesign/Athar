export type ThemePreference = "light" | "dark" | "system";

export const THEME_COOKIE_NAME = "theme";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isThemePreference(value: string | undefined | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function writeThemeCookie(theme: ThemePreference) {
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** Reflects the choice onto <html> immediately - "system" means defer to the OS via prefers-color-scheme. */
export function applyThemeToDocument(theme: ThemePreference) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}
