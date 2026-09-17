"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ContributionsPanel } from "@/components/knowledge/ContributionsPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { ApiError } from "@/lib/api/client";
import { updateMe } from "@/lib/api/accounts";
import { uploadFile } from "@/lib/api/files";
import { getUserProfile } from "@/lib/api/knowledge";
import type { StoredFileRef, UserProfile } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatPersonName, getInitials } from "@/lib/format";

// Matches BrandingSettingsForm.tsx's own copy of this constant (backend/config/
// settings.py's MAX_UPLOAD_SIZE_MB default) - shown for the description text
// only, not enforced client-side.
const MAX_UPLOAD_SIZE_MB = 2;

// Contributions leads the page (the thing you come here to check most
// often); editing your profile is the occasional action, so it's tucked
// into a collapsed disclosure below rather than a big always-open form up
// top - same "always-editable card, no dirty-tracking/discard" save flow
// as GeneralSettingsForm.tsx once it's open, just not open by default.
export default function AccountPage() {
  const t = useTranslations("account");
  const commonT = useTranslations("common");
  const { user, updateUser } = useAuth();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [username, setUsername] = useState(user?.username ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [title, setTitle] = useState(user?.title ?? "");
  // undefined = unchanged from the saved profile picture; null = explicitly
  // removed; StoredFileRef = a newly uploaded file staged but not yet saved -
  // same three-state pattern as BrandingSettingsForm.tsx's pendingLogo.
  const [pendingPicture, setPendingPicture] = useState<StoredFileRef | null | undefined>(undefined);
  const [pictureUploadProgress, setPictureUploadProgress] = useState<number | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const editSectionRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // Own contributions section below - a second fetch beyond `user` (which
  // has no `stats`) since ContributionsPanel needs the same aggregate counts
  // /users/[id] computes server-side (see knowledge/views.py's UserProfileView).
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (user) getUserProfile(user.id).then(setProfile);
  }, [user]);

  if (!user) return null;

  async function handlePictureSelected(file: File) {
    setPictureUploadProgress(0);
    setPictureError(null);
    try {
      // Uploading stages the file (and lets us preview it) - it isn't
      // attached to the account until Save is clicked, same as
      // BrandingSettingsForm.tsx's logo/favicon flow.
      const uploaded = await uploadFile(file, { onProgress: setPictureUploadProgress });
      setPendingPicture(uploaded);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : String(err));
    } finally {
      setPictureUploadProgress(null);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setUsernameError(null);
    try {
      const updated = await updateMe({
        username: username.trim() || null,
        first_name: firstName,
        last_name: lastName,
        title,
        ...(pendingPicture !== undefined ? { profile_picture_id: pendingPicture?.id ?? null } : {}),
      });
      updateUser(updated);
      setPendingPicture(undefined);
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.fields.username) {
        setUsernameError(err.fields.username);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const displayedPicture = pendingPicture !== undefined ? pendingPicture : user.profile_picture;

  // Opens the disclosure (it may already be) and scrolls its container into
  // view - scrolling to its top edge works regardless of open/closed state,
  // since expanding only grows the box downward, never moves its top.
  function handleEditProfileClick() {
    setIsEditOpen(true);
    editSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section>
      {/* Basic identity at a glance - same header treatment as the public
          profile page (/users/[id]) for consistency, sourced from `user`
          (available synchronously from AuthProvider) rather than waiting on
          the async `profile` fetch below, so this never flashes empty. */}
      <div className="flex items-start justify-between gap-4 bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar person={user} size="md" />
          <div className="min-w-0">
            <h1 className="font-display text-display text-on-surface truncate">{formatPersonName(user)}</h1>
            {user.title && <p className="font-body-lg text-body-lg text-on-surface-variant">{user.title}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-2 font-mono-sm text-mono-sm text-on-surface-variant">
              <span className="flex items-center gap-1">
                <Icon name="mail" size={14} />
                {user.email}
              </span>
              {user.roles.length > 0 && (
                <span className="flex items-center gap-1">
                  <Icon name="account" size={14} />
                  {user.roles.join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button variant="secondary" onClick={handleEditProfileClick} className="shrink-0">
          <Icon name="edit" size={16} />
          {t("editProfileButton")}
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("myContributionsTitle")}</h2>
        {profile ? (
          <ContributionsPanel profile={profile} />
        ) : (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        )}
      </div>

      <div ref={editSectionRef} className="bg-surface rounded-xl border border-outline-variant mt-10 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsEditOpen((open) => !open)}
          aria-expanded={isEditOpen}
          className="flex w-full items-center justify-between gap-4 p-6 text-start"
        >
          <span className="font-headline-md text-headline-md text-on-surface">{t("editProfileTitle")}</span>
          <Icon
            name="expand_more"
            className={`text-on-surface-variant shrink-0 transition-transform duration-200 ${isEditOpen ? "rotate-180" : ""}`}
          />
        </button>

        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
            isEditOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-6 px-6 pb-6">
              <div className="space-y-2">
                <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                  {t("profilePictureLabel")}
                </label>
                <PhotoDropzone
                  value={displayedPicture}
                  onFileSelected={handlePictureSelected}
                  onUnsupportedFile={() => setPictureError(commonT("unsupportedImageType"))}
                  onRemove={() => setPendingPicture(null)}
                  removeLabel={t("removePictureButton")}
                  progress={pictureUploadProgress}
                  alt={t("profilePictureLabel")}
                  fallback={
                    <span className="flex h-full w-full items-center justify-center font-label-caps text-label-caps text-on-surface-variant">
                      {getInitials(user)}
                    </span>
                  }
                  shape="circle"
                  className="h-32 w-32"
                />
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {t("profilePictureHint", { maxSize: MAX_UPLOAD_SIZE_MB })}
                </p>
                {pictureError && (
                  <p className="font-body-md text-body-md text-error" role="alert">
                    {pictureError}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                    {t("emailLabel")}
                  </label>
                  <input
                    className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-lg outline-none"
                    value={user.email}
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                    {t("usernameLabel")}
                  </label>
                  <input
                    className={`block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border rounded-lg focus:ring-1 focus:ring-primary outline-none transition-colors ${
                      usernameError ? "border-error focus:border-error" : "border-outline-variant focus:border-primary"
                    }`}
                    placeholder={t("usernamePlaceholder")}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setUsernameError(null);
                    }}
                  />
                  <p className={`font-body-md text-body-md ${usernameError ? "text-error" : "text-on-surface-variant"}`}>
                    {usernameError ?? t("usernameHint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                    {t("titleLabel")}
                  </label>
                  <input
                    className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                    placeholder={t("titlePlaceholder")}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                    {t("firstNameLabel")}
                  </label>
                  <input
                    className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                    {t("lastNameLabel")}
                  </label>
                  <input
                    className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              {user.roles.length > 0 && (
                <div className="space-y-2">
                  <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
                    {t("rolesLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {user.roles.map((role) => (
                      <span
                        key={role}
                        className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface font-label-caps text-label-caps uppercase"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="font-body-md text-body-md text-error" role="alert">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-4">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? commonT("saving") : commonT("save")}
                </Button>
                {savedAt && (
                  <span className="font-body-md text-body-md text-on-surface-variant">{commonT("saved")}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
