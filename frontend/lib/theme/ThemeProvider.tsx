"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { applyThemeToDocument, writeThemeCookie, type ThemePreference } from "./theme";

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

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

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    writeThemeCookie(next);
    applyThemeToDocument(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
