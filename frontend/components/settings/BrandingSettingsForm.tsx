"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { updateBrandingSettings, uploadFile } from "@/lib/api/organization";
import type { OrganizationSettings, StoredFileRef } from "@/lib/api/types";

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
  // undefined = unchanged from saved settings; null = explicitly cleared;
  // StoredFileRef = a newly uploaded file staged but not yet saved.
  const [pendingLogo, setPendingLogo] = useState<StoredFileRef | null | undefined>(undefined);
  const [pendingFavicon, setPendingFavicon] = useState<StoredFileRef | null | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const isDirty =
    primaryColor !== settings.primary_color ||
    secondaryColor !== settings.secondary_color ||
    pendingLogo !== undefined ||
    pendingFavicon !== undefined;

  const displayedLogo = pendingLogo !== undefined ? pendingLogo : settings.logo;
  const displayedFavicon = pendingFavicon !== undefined ? pendingFavicon : settings.favicon;

  async function handleLogoSelected(file: File) {
    setIsUploadingLogo(true);
    try {
      // Uploading stages the file (and lets us preview it) - it isn't
      // assigned as the org's logo until Save Changes is clicked.
      const uploaded = await uploadFile(file);
      setPendingLogo(uploaded);
    } finally {
      setIsUploadingLogo(false);
    }
  }

  async function handleFaviconSelected(file: File) {
    setIsUploadingFavicon(true);
    try {
      const uploaded = await uploadFile(file);
      setPendingFavicon(uploaded);
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
      </div>

      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("colorsTitle")}</h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            {t("colorsDescription")}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("primaryAccent")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-9 rounded-lg border border-outline-variant bg-transparent disabled:opacity-60"
                disabled={!canEdit}
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
              <input
                className="flex-1 px-4 py-2 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors disabled:opacity-60"
                disabled={!canEdit}
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("secondaryColor")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-9 rounded-lg border border-outline-variant bg-transparent disabled:opacity-60"
                disabled={!canEdit}
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
              />
              <input
                className="flex-1 px-4 py-2 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors disabled:opacity-60"
                disabled={!canEdit}
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
              />
            </div>
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
