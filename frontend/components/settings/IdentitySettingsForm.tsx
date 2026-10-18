"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { BrandingPreview, SettingsWithPreview } from "@/components/settings/BrandingPreview";
import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Icon } from "@/components/ui/Icon";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { uploadFile } from "@/lib/api/files";
import { updateBrandingSettings, updateGeneralSettings } from "@/lib/api/organization";
import type { OrganizationSettings, StoredFileRef } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";
import { hasLowContrast } from "@/lib/theme/brandColors";

// Matches backend/config/settings.py MAX_UPLOAD_SIZE_MB's default - shown
// here for the description text only, not enforced client-side (the
// backend is the real boundary; see files/serializers.py validate_file).
const MAX_UPLOAD_SIZE_MB = 2;

interface IdentitySettingsFormProps {
  settings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
  /** organization.manage - the name saves through the General endpoint. */
  canEditName: boolean;
  /** branding.manage - logo, favicon, and colors save through the Branding endpoint. */
  canEditBranding: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}

// Organization > Identity & Branding - the org name plus its logo, favicon,
// and colors on one page, so the live preview beside it reflects all of
// them together. The name and the branding fields are still two backend
// endpoints with separate permissions (see organization/views.py), so each
// half is gated on its own and Save only calls the endpoint(s) whose fields
// actually changed.
export function IdentitySettingsForm({
  settings,
  onUpdate,
  canEditName,
  canEditBranding,
  onDirtyChange,
}: IdentitySettingsFormProps) {
  const t = useTranslations("settings.branding");
  const generalT = useTranslations("settings.general");
  const commonT = useTranslations("common");
  const [name, setName] = useState(settings.name);
  const [primaryColor, setPrimaryColor] = useState(settings.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(settings.secondary_color);
  const [primaryColorDark, setPrimaryColorDark] = useState(settings.primary_color_dark);
  const [secondaryColorDark, setSecondaryColorDark] = useState(settings.secondary_color_dark);
  // undefined = unchanged from saved settings; null = explicitly cleared;
  // StoredFileRef = a newly uploaded file staged but not yet saved.
  const [pendingLogo, setPendingLogo] = useState<StoredFileRef | null | undefined>(undefined);
  const [pendingFavicon, setPendingFavicon] = useState<StoredFileRef | null | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(null);
  const [faviconUploadProgress, setFaviconUploadProgress] = useState<number | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [faviconError, setFaviconError] = useState<string | null>(null);

  const nameChanged = name !== settings.name;
  const brandingChanged =
    primaryColor !== settings.primary_color ||
    secondaryColor !== settings.secondary_color ||
    primaryColorDark !== settings.primary_color_dark ||
    secondaryColorDark !== settings.secondary_color_dark ||
    pendingLogo !== undefined ||
    pendingFavicon !== undefined;
  const isDirty = nameChanged || brandingChanged;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const displayedLogo = pendingLogo !== undefined ? pendingLogo : settings.logo;
  const displayedFavicon = pendingFavicon !== undefined ? pendingFavicon : settings.favicon;

  async function handleLogoSelected(file: File) {
    setLogoUploadProgress(0);
    setLogoError(null);
    try {
      // Uploading stages the file (and lets us preview it) - it isn't
      // assigned as the org's logo until Save Changes is clicked.
      const uploaded = await uploadFile(file, { onProgress: setLogoUploadProgress });
      setPendingLogo(uploaded);
    } catch (err) {
      setLogoError(errorMessage(err));
    } finally {
      setLogoUploadProgress(null);
    }
  }

  async function handleFaviconSelected(file: File) {
    setFaviconUploadProgress(0);
    setFaviconError(null);
    try {
      const uploaded = await uploadFile(file, { onProgress: setFaviconUploadProgress });
      setPendingFavicon(uploaded);
    } catch (err) {
      setFaviconError(errorMessage(err));
    } finally {
      setFaviconUploadProgress(null);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      if (nameChanged) {
        onUpdate(await updateGeneralSettings({ name }));
      }
      if (brandingChanged) {
        onUpdate(
          await updateBrandingSettings({
            primary_color: primaryColor,
            secondary_color: secondaryColor,
            primary_color_dark: primaryColorDark,
            secondary_color_dark: secondaryColorDark,
            ...(pendingLogo !== undefined ? { logo_id: pendingLogo?.id ?? null } : {}),
            ...(pendingFavicon !== undefined ? { favicon_id: pendingFavicon?.id ?? null } : {}),
          }),
        );
        setPendingLogo(undefined);
        setPendingFavicon(undefined);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    setName(settings.name);
    setPrimaryColor(settings.primary_color);
    setSecondaryColor(settings.secondary_color);
    setPrimaryColorDark(settings.primary_color_dark);
    setSecondaryColorDark(settings.secondary_color_dark);
    setPendingLogo(undefined);
    setPendingFavicon(undefined);
  }

  return (
    <SettingsWithPreview
      preview={
        <BrandingPreview
          orgName={name}
          logo={displayedLogo}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          primaryColorDark={primaryColorDark}
          secondaryColorDark={secondaryColorDark}
        />
      }
    >
      <div className="space-y-6">
        <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {generalT("nameLabel")}
          </label>
          <ChangedIndicator changed={nameChanged}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors disabled:opacity-60"
              disabled={!canEditName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </ChangedIndicator>
        </div>

        <div className="grid grid-cols-1 @md:grid-cols-2 gap-6">
          <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
            <div>
              <h2 className="font-headline-md text-headline-md text-on-surface">{t("logoTitle")}</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                {t("logoDescription", { maxSize: MAX_UPLOAD_SIZE_MB })}
              </p>
            </div>
            <ChangedIndicator changed={pendingLogo !== undefined} className="inline-block">
              <PhotoDropzone
                value={displayedLogo}
                onFileSelected={handleLogoSelected}
                onUnsupportedFile={() => setLogoError(commonT("unsupportedImageType"))}
                disabled={!canEditBranding}
                progress={logoUploadProgress}
                alt={t("logoTitle")}
                fit="contain"
                className="h-36 w-36"
              />
            </ChangedIndicator>
            {logoError && (
              <p className="font-body-md text-body-md text-error" role="alert">
                {logoError}
              </p>
            )}
          </div>

          <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
            <div>
              <h2 className="font-headline-md text-headline-md text-on-surface">{t("faviconTitle")}</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("faviconDescription")}</p>
            </div>
            <ChangedIndicator changed={pendingFavicon !== undefined} className="inline-block">
              <PhotoDropzone
                value={displayedFavicon}
                onFileSelected={handleFaviconSelected}
                onUnsupportedFile={() => setFaviconError(commonT("unsupportedImageType"))}
                disabled={!canEditBranding}
                progress={faviconUploadProgress}
                alt={t("faviconTitle")}
                fit="contain"
                className="h-28 w-28"
              />
            </ChangedIndicator>
            {faviconError && (
              <p className="font-body-md text-body-md text-error" role="alert">
                {faviconError}
              </p>
            )}
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("colorsTitle")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("colorsDescription")}</p>
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
                changed={primaryColor !== settings.primary_color}
                canEdit={canEditBranding}
              />
              <ColorInputField
                label={t("secondaryColor")}
                value={secondaryColor}
                onChange={setSecondaryColor}
                changed={secondaryColor !== settings.secondary_color}
                canEdit={canEditBranding}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("darkThemeLabel")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorInputField
                label={t("primaryAccent")}
                value={primaryColorDark}
                onChange={setPrimaryColorDark}
                changed={primaryColorDark !== settings.primary_color_dark}
                canEdit={canEditBranding}
              />
              <ColorInputField
                label={t("secondaryColor")}
                value={secondaryColorDark}
                onChange={setSecondaryColorDark}
                changed={secondaryColorDark !== settings.secondary_color_dark}
                canEdit={canEditBranding}
              />
            </div>
          </div>
        </div>

        {(canEditName || canEditBranding) && (
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
    </SettingsWithPreview>
  );
}

interface ColorInputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  canEdit: boolean;
  changed: boolean;
}

function ColorInputField({ label, value, onChange, canEdit, changed }: ColorInputFieldProps) {
  const t = useTranslations("settings.branding");
  const lowContrast = hasLowContrast(value);

  return (
    <div className="space-y-2">
      <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">{label}</label>
      <ChangedIndicator changed={changed} className="flex items-center gap-2">
        <input
          type="color"
          // Strips the browser's default inner padding/border so the swatch
          // fills the whole box instead of sitting inset inside it.
          className="h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-outline-variant bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-none [&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded-none"
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
      </ChangedIndicator>
      {lowContrast && (
        <p className="flex items-center gap-1 font-body-md text-body-md text-error" role="alert">
          <Icon name="report_problem" size={14} />
          {t("lowContrastWarning")}
        </p>
      )}
    </div>
  );
}
