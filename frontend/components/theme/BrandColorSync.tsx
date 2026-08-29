"use client";

import { useEffect } from "react";

import { useOrganization } from "@/lib/organization/OrganizationProvider";
import { applyBrandColors } from "@/lib/theme/brandColors";
import { useTheme } from "@/lib/theme/ThemeProvider";

// Renders nothing - applies the org's brand colors (the light/dark pair
// matching the currently resolved theme) as CSS custom properties on <html>,
// so a branding change or a theme switch takes effect immediately with no
// reload. Must render below both ThemeProvider and OrganizationProvider
// (see app/[locale]/layout.tsx).
export function BrandColorSync() {
  const { resolvedTheme } = useTheme();
  const { settings } = useOrganization();

  useEffect(() => {
    if (!settings) return;
    applyBrandColors(
      {
        primary: resolvedTheme === "dark" ? settings.primary_color_dark : settings.primary_color,
        secondary: resolvedTheme === "dark" ? settings.secondary_color_dark : settings.secondary_color,
      },
      resolvedTheme,
    );
  }, [settings, resolvedTheme]);

  return null;
}
