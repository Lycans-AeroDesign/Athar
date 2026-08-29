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
 * Picks readable text over an arbitrary admin-picked brand color. This is a
 * luminance-threshold heuristic, not full Material Design 3 tonal palette
 * generation (which derives every role from one seed hue via HCT tone/chroma
 * math - see e.g. Google's material-color-utilities) - close enough for a
 * single custom color, not a pixel-perfect Material palette.
 */
function contrastingOnColor(hex: string): "#000000" | "#ffffff" {
  return relativeLuminance(hex) > 0.4 ? "#000000" : "#ffffff";
}

/**
 * Derives a "container" tone from a role color: lighter in light mode (M3's
 * containers sit lighter than their base role on a light scheme) and darker
 * in dark mode (M3 inverts this - a dark scheme's primary/secondary are
 * already light/pastel, so their containers run darker/more saturated). Flat
 * linear-RGB blend, same simplification as contrastingOnColor above.
 */
function deriveContainer(hex: string, mode: "light" | "dark"): string {
  return mode === "dark" ? mixHex(hex, [0, 0, 0], 0.45) : mixHex(hex, [255, 255, 255], 0.75);
}

/**
 * Derives a hover tone for a container color: darker in light mode, lighter
 * in dark mode (standard state-layer darken/lighten feedback), so a brand
 * color's hover state stays visibly tied to that brand color instead of
 * falling back to a fixed default.
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
 * Whether `hex`, used as a solid fill with its auto-picked contrasting text
 * color (see contrastingOnColor), falls below WCAG AA (4.5:1) - a color near
 * mid-gray luminance can fail contrast against both black and white text, so
 * flipping the text color alone isn't always enough. Used to warn admins
 * picking brand colors in Branding settings.
 */
export function hasLowContrast(hex: string): boolean {
  return contrastRatio(hex, contrastingOnColor(hex)) < MIN_CONTRAST_RATIO;
}

interface BrandColors {
  primary?: string;
  secondary?: string;
}

/**
 * Applies the org's brand colors as CSS custom properties on <html>,
 * overriding globals.css's defaults - both the base primary/secondary roles
 * and their "container" tones (bg-primary-container, bg-secondary-container -
 * used by e.g. Button's primary variant and SideNav's selected-item
 * highlight), each with a matching "on" text color for contrast.
 */
export function applyBrandColors(colors: BrandColors, mode: "light" | "dark") {
  const root = document.documentElement;
  if (colors.primary) {
    root.style.setProperty("--color-primary", colors.primary);
    root.style.setProperty("--color-on-primary", contrastingOnColor(colors.primary));
    root.style.setProperty("--color-primary-hover", deriveHover(colors.primary, mode));
    const container = deriveContainer(colors.primary, mode);
    root.style.setProperty("--color-primary-container", container);
    root.style.setProperty("--color-on-primary-container", contrastingOnColor(container));
    root.style.setProperty("--color-primary-container-hover", deriveHover(container, mode));
  }
  if (colors.secondary) {
    root.style.setProperty("--color-secondary", colors.secondary);
    root.style.setProperty("--color-on-secondary", contrastingOnColor(colors.secondary));
    const container = deriveContainer(colors.secondary, mode);
    root.style.setProperty("--color-secondary-container", container);
    root.style.setProperty("--color-on-secondary-container", contrastingOnColor(container));
    root.style.setProperty("--color-secondary-container-hover", deriveHover(container, mode));
  }
}
