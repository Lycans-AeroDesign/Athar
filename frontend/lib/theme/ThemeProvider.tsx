"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { applyThemeToDocument, writeThemeCookie, type ThemePreference } from "./theme";

type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  /** "system" resolved against the OS preference - use this (not `theme`) to pick theme-dependent values like brand colors. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// The <html data-theme> attribute for the FIRST paint is set server-side in
// app/layout.tsx (reading the cookie via next/headers), so there's no
// flash-of-wrong-theme to fix on mount here - this provider only needs to
// react to the user actively changing their preference afterwards.
export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: ThemePreference;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(initialTheme);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    writeThemeCookie(next);
    applyThemeToDocument(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
