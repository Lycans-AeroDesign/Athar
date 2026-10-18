function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (c: number) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Linear-RGB blend toward `target` by `t` (0 = `hex` unchanged, 1 = `target`). */
function mixHex(hex: string, target: [number, number, number], t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (target[0] - r) * t, g + (target[1] - g) * t, b + (target[2] - b) * t);
}

// WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance).
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks readable text over an admin-picked brand color: a luminance-threshold heuristic, not full
 * Material 3 tonal palette generation (HCT) - close enough for a single custom color.
 */
function contrastingOnColor(hex: string): "#000000" | "#ffffff" {
  return relativeLuminance(hex) > 0.4 ? "#000000" : "#ffffff";
}

/**
 * Derives a "container" tone from a role color: lighter in light mode, darker in dark mode (a dark
 * scheme's primary/secondary are already pastel, so M3 containers run darker). Flat linear-RGB
 * blend, same simplification as contrastingOnColor.
 */
function deriveContainer(hex: string, mode: "light" | "dark"): string {
  return mode === "dark" ? mixHex(hex, [0, 0, 0], 0.45) : mixHex(hex, [255, 255, 255], 0.75);
}

/**
 * Derives a hover tone for a container color: darker in light mode, lighter in dark mode,
 * keeping hover tied to the brand color.
 */
function deriveHover(hex: string, mode: "light" | "dark"): string {
  return mode === "dark" ? mixHex(hex, [255, 255, 255], 0.2) : mixHex(hex, [0, 0, 0], 0.15);
}

/** WCAG contrast ratio between two colors (1 = identical, 21 = black on white). */
function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG AA minimum for normal text/UI components rendered as a solid fill.
const MIN_CONTRAST_RATIO = 4.5;

/**
 * Whether `hex` as a solid fill with its auto-picked text color (see contrastingOnColor) falls
 * below WCAG AA (4.5:1). Mid-gray can fail against both black and white text, so flipping the
 * text alone isn't enough. Used to warn admins in Branding settings.
 */
export function hasLowContrast(hex: string): boolean {
  return contrastRatio(hex, contrastingOnColor(hex)) < MIN_CONTRAST_RATIO;
}

interface BrandColors {
  primary?: string;
  secondary?: string;
}

/**
 * The CSS custom properties for the org's brand colors, overriding globals.css's defaults: the
 * primary/secondary roles, their "container" tones (used by Button's primary variant and SideNav's
 * selected item) and matching "on" text colors.
 */
export function brandColorVars(colors: BrandColors, mode: "light" | "dark"): Record<string, string> {
  const vars: Record<string, string> = {};
  if (colors.primary) {
    vars["--color-primary"] = colors.primary;
    vars["--color-on-primary"] = contrastingOnColor(colors.primary);
    vars["--color-primary-hover"] = deriveHover(colors.primary, mode);
    const container = deriveContainer(colors.primary, mode);
    vars["--color-primary-container"] = container;
    vars["--color-on-primary-container"] = contrastingOnColor(container);
    vars["--color-primary-container-hover"] = deriveHover(container, mode);
  }
  if (colors.secondary) {
    vars["--color-secondary"] = colors.secondary;
    vars["--color-on-secondary"] = contrastingOnColor(colors.secondary);
    const container = deriveContainer(colors.secondary, mode);
    vars["--color-secondary-container"] = container;
    vars["--color-on-secondary-container"] = contrastingOnColor(container);
    vars["--color-secondary-container-hover"] = deriveHover(container, mode);
  }
  return vars;
}

/** Applies brandColorVars app-wide, on <html>. Branding settings' live
 * preview applies the same vars to its own subtree instead (see
 * BrandingPreview.tsx), so unsaved colors never leak into the real app. */
export function applyBrandColors(colors: BrandColors, mode: "light" | "dark") {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(brandColorVars(colors, mode))) {
    root.style.setProperty(name, value);
  }
}
