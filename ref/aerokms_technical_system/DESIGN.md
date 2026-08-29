---
name: AeroKMS Technical System
colors:
  surface: '#faf8ff'
  surface-dim: '#dad9e3'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2fd'
  surface-container: '#eeedf7'
  surface-container-high: '#e8e7f2'
  surface-container-highest: '#e2e1ec'
  on-surface: '#1a1b22'
  on-surface-variant: '#444654'
  inverse-surface: '#2f3038'
  inverse-on-surface: '#f1f0fa'
  outline: '#747686'
  outline-variant: '#c4c5d6'
  surface-tint: '#2151da'
  primary: '#00247d'
  on-primary: '#ffffff'
  primary-container: '#1d4ed8'
  on-primary-container: '#cad3ff'
  inverse-primary: '#b7c4ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d4e3ff'
  on-secondary-container: '#56657c'
  tertiary: '#3d445a'
  on-tertiary: '#ffffff'
  tertiary-container: '#841e02'
  on-tertiary-container: '#ff967b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b7c4ff'
  on-primary-fixed: '#001551'
  on-primary-fixed-variant: '#063ab2'
  secondary-fixed: '#d4e3ff'
  secondary-fixed-dim: '#b8c7e2'
  on-secondary-fixed: '#0c1c30'
  on-secondary-fixed-variant: '#39485e'
  tertiary-fixed: '#ffdbd2'
  tertiary-fixed-dim: '#ffb4a2'
  on-tertiary-fixed: '#3c0800'
  on-tertiary-fixed-variant: '#872004'
  background: '#faf8ff'
  on-background: '#1a1b22'
  surface-variant: '#e2e1ec'
typography:
  display:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  layout-margin: 40px
  layout-gutter: 20px
---

## Brand & Style
The design system is engineered for high-density information environments where clarity, precision, and structural integrity are paramount. While it follows a **Corporate / Modern** aesthetic with an emphasis on technical documentation, this version introduces a softer, more approachable interface through increased roundedness.

The system avoids decorative elements, focusing instead on a "Connected Knowledge" narrative through logical grouping and visible relationships. The emotional response is one of reliability and systematic order, but with a modern, softened ergonomic feel that reduces visual fatigue in complex aerospace and engineering workflows.

## Colors
The palette is anchored by "Engineering Blue" (#1D4ED8), used purposefully for primary actions, active navigation states, and relationship indicators.

- **Backgrounds:** Use pure white (#FFFFFF) for the primary reading surface of technical articles to maximize contrast and legibility.
- **Surfaces:** Use neutral surface colors for sidebars and relationship panels to create functional separation.
- **Status:** Semantic colors (success, warning, error) are used strictly for status indicators like test results or system alerts and are never applied decoratively.

## Typography
This design system utilizes **Inter** for its neutral, highly legible character at small sizes, and **JetBrains Mono** for all technical data, code snippets, part numbers, and metadata.

- **Hierarchy:** Typography manages dense documentation. `headline-md` serves as the standard for article sections.
- **Data Representation:** Use `mono-sm` for non-prose data, such as serial numbers or CAD file references.
- **Labels:** `label-caps` is reserved for table headers and small metadata tags to distinguish them from actionable body text.

## Layout & Spacing
The layout uses a **Fixed Grid** philosophy for content areas to ensure line lengths remain readable (max-width: 800px for prose).

- **Grid:** A 12-column system is used for dashboards, while a 3-pane layout is standard for knowledge browsing.
- **Responsive:** On mobile, sidebars collapse into a standard navigation drawer to focus purely on content.
- **Density:** High-density spacing (8px/16px) is preferred for data tables, while generous spacing (24px/32px) is used for technical article flow.

## Elevation & Depth
The system uses **Tonal Layers** and **Low-contrast outlines** rather than heavy shadows to maintain a clean, technical look.

- **Surface Tiers:** White (#FFFFFF) defines the base content area, while light gray (#F8FAFC) defines secondary panels.
- **Borders:** Containers use a 1px solid border (#E2E8F0) to define structure.
- **Interactivity:** A soft, ambient shadow is used exclusively for floating elements like dropdowns or modals to provide depth without breaking the technical aesthetic.

## Shapes
The shape language has been updated to be softer and more inviting, moving away from sharp industrial corners.

- **Standard Elements:** Use `ROUND_EIGHT` (8px) as the base radius for buttons, input fields, and small UI components.
- **Containers:** Use `ROUND_SIXTEEN` (16px) for larger surfaces, including cards, modals, and relationship panels.
- **Consistency:** Ensure that even high-density components reflect this softened aesthetic to maintain a unified, modern visual language across the technical suite.

## Components
- **Buttons:** All buttons must use `ROUND_EIGHT`. Primary buttons feature solid backgrounds, while secondary buttons use outlines. Avoid sharp-cornered rectangular shapes.
- **Input Fields:** Use `ROUND_EIGHT` with a 1px border. Ensure internal padding is sufficient to accommodate the increased corner radius without crowding text.
- **Cards & UI Containers:** Use `ROUND_SIXTEEN` for all container-level elements. This includes Technical Article cards and Relationship Panels.
- **Chips & Tags:** Use pill-shaped (full) rounding for status tags and metadata labels to provide maximum visual contrast against the more structured card shapes.
- **Technical Article:** High-contrast text on white surfaces. Sidebars and "Table of Contents" should utilize `ROUND_EIGHT` for their active state indicators.
- **Knowledge Graph:** Nodes should be circular or highly rounded to complement the new shape language, using primary blue for active nodes.