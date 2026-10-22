"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";

import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { BrandMark } from "@/components/ui/BrandMark";
import { Icon } from "@/components/ui/Icon";
import type { StoredFileRef } from "@/lib/api/types";
import { brandColorVars } from "@/lib/theme/brandColors";

/** Two-column layout for a settings form with the preview beside it - a
 * fixed-width preview column once *this container* is wide enough for both
 * (a container query, not a viewport breakpoint: the space left over depends
 * on the app SideNav and the Settings section nav beside it, not just the
 * window width), dropping below the form otherwise. */
export function SettingsWithPreview({ children, preview }: { children: ReactNode; preview: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
        {children}
        {preview}
      </div>
    </div>
  );
}

interface BrandingPreviewProps {
  orgName: string;
  /** The logo as currently staged in the form (saved, newly uploaded, or cleared). */
  logo: StoredFileRef | null;
  primaryColor: string;
  secondaryColor: string;
  primaryColorDark: string;
  secondaryColorDark: string;
}

// Live preview beside the General and Branding settings forms - a
// scaled-down app shell in both themes, rendered with that form's *unsaved*
// values (the org name from General, logo/colors from Branding; each form
// passes the saved value for whatever it doesn't edit). Each pane pins its own
// palette via data-preview-theme (see globals.css) and sets the brand color
// vars inline on itself, so nothing here touches the real app's theme until
// Save Changes is clicked.
export function BrandingPreview({
  orgName,
  logo,
  primaryColor,
  secondaryColor,
  primaryColorDark,
  secondaryColorDark,
}: BrandingPreviewProps) {
  const t = useTranslations("settings.branding");

  return (
    // Sticky inside <main>'s own scroll container (see the (protected)
    // layout), so it stays in view beside a long form.
    <aside className="@3xl:sticky @3xl:top-0 bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("previewTitle")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("previewDescription")}</p>
      </div>
      {/* Side by side when the preview drops below the form, stacked once
          it's in the narrow side column. */}
      <div className="grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-1 gap-4">
        <PreviewPane
          mode="light"
          label={t("lightThemeLabel")}
          orgName={orgName}
          logo={logo}
          primary={primaryColor}
          secondary={secondaryColor}
        />
        <PreviewPane
          mode="dark"
          label={t("darkThemeLabel")}
          orgName={orgName}
          logo={logo}
          primary={primaryColorDark}
          secondary={secondaryColorDark}
        />
      </div>
    </aside>
  );
}

// The hex text input updates on every keystroke - a half-typed value (e.g.
// "#12") would derive garbage tones, so it falls back to the theme default
// until the value is a complete 6-digit hex.
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface PreviewPaneProps {
  mode: "light" | "dark";
  label: string;
  orgName: string;
  logo: StoredFileRef | null;
  primary: string;
  secondary: string;
}

function PreviewPane({ mode, label, orgName, logo, primary, secondary }: PreviewPaneProps) {
  const t = useTranslations("settings.branding");
  const navT = useTranslations("nav");
  const vars = brandColorVars(
    {
      primary: HEX_COLOR.test(primary) ? primary : undefined,
      secondary: HEX_COLOR.test(secondary) ? secondary : undefined,
    },
    mode,
  );

  return (
    <div className="space-y-2">
      <span className="block font-label-caps text-label-caps text-on-surface-variant uppercase">{label}</span>
      <div
        data-preview-theme={mode}
        style={vars as CSSProperties}
        aria-hidden
        className="flex h-56 overflow-hidden rounded-xl border border-outline-variant bg-background text-on-background select-none pointer-events-none"
      >
        {/* Sidebar */}
        <div className="w-28 shrink-0 flex flex-col bg-surface-container-low border-e border-outline-variant">
          <div className="flex items-center gap-1.5 p-2 border-b border-outline-variant">
            {logo ? (
              <AuthenticatedImage
                src={logo.download_url}
                alt=""
                className="h-7 w-7 shrink-0 rounded object-contain"
                fallback={<BrandMark className="h-7 w-7 shrink-0" />}
              />
            ) : (
              <BrandMark className="h-7 w-7 shrink-0" />
            )}
            <span className="truncate text-[11px] font-bold text-primary">{orgName}</span>
          </div>
          <div className="p-1.5 space-y-1 text-[10px]">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary-container text-on-primary-container font-bold">
              <Icon name="dashboard" size={12} />
              <span className="truncate">{navT("dashboard")}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 text-on-surface-variant">
              <Icon name="menu_book" size={12} />
              <span className="truncate">{navT("knowledge")}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 text-on-surface-variant">
              <Icon name="architecture" size={12} />
              <span className="truncate">{navT("projects")}</span>
            </div>
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="h-8 shrink-0 flex items-center px-2 bg-surface border-b border-outline-variant">
            <div className="h-4 flex-1 rounded-md bg-surface-container-low border border-outline-variant" />
            <div className="ms-2 h-4 w-4 rounded-full bg-secondary" />
          </div>
          <div className="flex-1 p-2.5 space-y-2">
            <div className="rounded-lg bg-primary p-2 text-on-primary">
              <div className="text-[9px] font-semibold uppercase opacity-80">{t("previewFeaturedLabel")}</div>
              <div className="text-[11px] font-bold truncate">{t("previewSampleTitle")}</div>
            </div>
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-2 space-y-1.5">
              <div className="flex items-center gap-1">
                <span className="rounded-full bg-secondary-container text-on-secondary-container px-1.5 py-0.5 text-[9px] font-semibold">
                  {t("previewTagLabel")}
                </span>
              </div>
              <div className="text-[10px] font-semibold text-primary truncate">{t("previewSampleLink")}</div>
              <div className="h-1.5 w-full rounded bg-surface-container-high" />
              <div className="h-1.5 w-2/3 rounded bg-surface-container-high" />
            </div>
            <div className="flex gap-1.5">
              <span className="rounded-md bg-primary text-on-primary px-2 py-1 text-[9px] font-semibold uppercase">
                {t("previewPrimaryButton")}
              </span>
              <span className="rounded-md border border-outline-variant bg-surface text-on-surface px-2 py-1 text-[9px] font-semibold uppercase">
                {t("previewSecondaryButton")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
