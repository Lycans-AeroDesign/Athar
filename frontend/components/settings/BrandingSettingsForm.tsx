"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { uploadFile } from "@/lib/api/files";
import { updateBrandingSettings } from "@/lib/api/organization";
import type { OrganizationSettings, StoredFileRef } from "@/lib/api/types";
import { hasLowContrast } from "@/lib/theme/brandColors";

// Matches backend/config/settings.py MAX_UPLOAD_SIZE_MB's default - shown
// here for the description text only, not enforced client-side (the
// backend is the real boundary; see files/serializers.py validate_file).
const MAX_UPLOAD_SIZE_MB = 2;

interface BrandingSettingsFormProps {
  settings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
  canEdit: boolean;
}

export function BrandingSettingsForm({ settings, onUpdate, canEdit }: BrandingSettingsFormProps) {
  const t = useTranslations("settings.branding");
  const commonT = useTranslations("common");
  const [primaryColor, setPrimaryColor] = useState(settings.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(settings.secondary_color);
  const [primaryColorDark, setPrimaryColorDark] = useState(settings.primary_color_dark);
  const [secondaryColorDark, setSecondaryColorDark] = useState(settings.secondary_color_dark);
  // undefined = unchanged from saved settings; null = explicitly cleared;
  // StoredFileRef = a newly uploaded file staged but not yet saved.
  const [pendingLogo, setPendingLogo] = useState<StoredFileRef | null | undefined>(undefined);
  const [pendingFavicon, setPendingFavicon] = useState<StoredFileRef | null | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const isDirty =
    primaryColor !== settings.primary_color ||
    secondaryColor !== settings.secondary_color ||
    primaryColorDark !== settings.primary_color_dark ||
    secondaryColorDark !== settings.secondary_color_dark ||
    pendingLogo !== undefined ||
    pendingFavicon !== undefined;

  const displayedLogo = pendingLogo !== undefined ? pendingLogo : settings.logo;
  const displayedFavicon = pendingFavicon !== undefined ? pendingFavicon : settings.favicon;

  async function handleLogoSelected(file: File) {
    setIsUploadingLogo(true);
    setLogoError(null);
    try {
      // Uploading stages the file (and lets us preview it) - it isn't
      // assigned as the org's logo until Save Changes is clicked.
      const uploaded = await uploadFile(file);
      setPendingLogo(uploaded);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploadingLogo(false);
    }
  }

  async function handleFaviconSelected(file: File) {
    setIsUploadingFavicon(true);
    setFaviconError(null);
    try {
      const uploaded = await uploadFile(file);
      setPendingFavicon(uploaded);
    } catch (err) {
      setFaviconError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploadingFavicon(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await updateBrandingSettings({
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        primary_color_dark: primaryColorDark,
        secondary_color_dark: secondaryColorDark,
        ...(pendingLogo !== undefined ? { logo_id: pendingLogo?.id ?? null } : {}),
        ...(pendingFavicon !== undefined ? { favicon_id: pendingFavicon?.id ?? null } : {}),
      });
      onUpdate(updated);
      setPendingLogo(undefined);
      setPendingFavicon(undefined);
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    setPrimaryColor(settings.primary_color);
    setSecondaryColor(settings.secondary_color);
    setPrimaryColorDark(settings.primary_color_dark);
    setSecondaryColorDark(settings.secondary_color_dark);
    setPendingLogo(undefined);
    setPendingFavicon(undefined);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("logoTitle")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            {t("logoDescription", { maxSize: MAX_UPLOAD_SIZE_MB })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-24 w-24 rounded-lg border border-dashed border-outline-variant bg-surface-container-low flex items-center justify-center overflow-hidden shrink-0">
            {displayedLogo ? (
              <AuthenticatedImage
                src={displayedLogo.download_url}
                alt={t("logoTitle")}
                className="h-full w-full object-contain"
              />
            ) : (
              <Icon name="image" className="text-outline" size={28} />
            )}
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLogoSelected(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            disabled={!canEdit || isUploadingLogo}
            onClick={() => logoInputRef.current?.click()}
          >
            <Icon name="upload" size={16} />
            {isUploadingLogo ? t("uploading") : t("uploadLogo")}
          </Button>
        </div>
        {logoError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {logoError}
          </p>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("faviconTitle")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            {t("faviconDescription")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg border border-outline-variant bg-surface-container-low flex items-center justify-center overflow-hidden shrink-0">
            {displayedFavicon ? (
              <AuthenticatedImage
                src={displayedFavicon.download_url}
                alt={t("faviconTitle")}
                className="h-full w-full object-contain"
              />
            ) : (
              <Icon name="language" className="text-outline" size={20} />
            )}
          </div>
          <input
            ref={faviconInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFaviconSelected(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            disabled={!canEdit || isUploadingFavicon}
            onClick={() => faviconInputRef.current?.click()}
          >
            {isUploadingFavicon ? t("uploading") : t("uploadFavicon")}
          </Button>
        </div>
        {faviconError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {faviconError}
          </p>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("colorsTitle")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            {t("colorsDescription")}
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("lightThemeLabel")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ColorInputField
              label={t("primaryAccent")}
              value={primaryColor}
              onChange={setPrimaryColor}
              canEdit={canEdit}
            />
            <ColorInputField
              label={t("secondaryColor")}
              value={secondaryColor}
              onChange={setSecondaryColor}
              canEdit={canEdit}
            />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("darkThemeLabel")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ColorInputField
              label={t("primaryAccent")}
              value={primaryColorDark}
              onChange={setPrimaryColorDark}
              canEdit={canEdit}
            />
            <ColorInputField
              label={t("secondaryColor")}
              value={secondaryColorDark}
              onChange={setSecondaryColorDark}
              canEdit={canEdit}
            />
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty}>
            {commonT("discard")}
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? commonT("saving") : commonT("save")}
          </Button>
        </div>
      )}
    </div>
  );
}

interface ColorInputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  canEdit: boolean;
}

function ColorInputField({ label, value, onChange, canEdit }: ColorInputFieldProps) {
  const t = useTranslations("settings.branding");
  const lowContrast = hasLowContrast(value);

  return (
    <div className="space-y-2">
      <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-9 rounded-lg border border-outline-variant bg-transparent disabled:opacity-60"
          disabled={!canEdit}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="flex-1 px-4 py-2 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors disabled:opacity-60"
          disabled={!canEdit}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {lowContrast && (
        <p className="flex items-center gap-1 font-body-md text-body-md text-error" role="alert">
          <Icon name="report_problem" size={14} />
          {t("lowContrastWarning")}
        </p>
      )}
    </div>
  );
}
