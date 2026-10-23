"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { ApiError } from "@/lib/api/client";
import { updateMe } from "@/lib/api/accounts";
import { DEFAULT_UPLOAD_LIMIT_MB, getUploadLimitMb, uploadFile } from "@/lib/api/files";
import type { StoredFileRef, User } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { errorMessage } from "@/lib/errors";
import { getInitials } from "@/lib/format";

// The hint text starts at the platform default and swaps to the org's live
// limit from the settings endpoint once it resolves (see
// lib/api/files.ts getUploadLimitMb) - never enforced here, uploadFile is.
const MAX_UPLOAD_SIZE_MB = DEFAULT_UPLOAD_LIMIT_MB;


interface EditProfileModalProps {
  user: User;
  onClose: () => void;
}

// My Account's "Edit Profile" dialog. Mount it only while open (the account
// page renders it conditionally) so the draft below is re-seeded from the
// saved profile every time it opens, instead of carrying a half-finished
// edit over from a previous, cancelled session.
export function EditProfileModal({ user, onClose }: EditProfileModalProps) {
  const t = useTranslations("account");
  const commonT = useTranslations("common");
  const { updateUser } = useAuth();

  const [username, setUsername] = useState(user.username ?? "");
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [title, setTitle] = useState(user.title);
  // undefined = unchanged from the saved profile picture; null = explicitly
  // removed; StoredFileRef = a newly uploaded file staged but not yet saved -
  // same three-state pattern as IdentitySettingsForm.tsx's pendingLogo.
  const [pendingPicture, setPendingPicture] = useState<StoredFileRef | null | undefined>(undefined);
  const [pictureUploadProgress, setPictureUploadProgress] = useState<number | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  // The org's live upload limit (may differ from the platform default above).
  const [uploadLimitMb, setUploadLimitMb] = useState<number>(MAX_UPLOAD_SIZE_MB);

  useEffect(() => {
    let cancelled = false;
    void getUploadLimitMb().then((limitMb) => {
      if (!cancelled) setUploadLimitMb(limitMb);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDirty =
    username !== (user.username ?? "") ||
    firstName !== user.first_name ||
    lastName !== user.last_name ||
    title !== user.title ||
    pendingPicture !== undefined;

  async function handlePictureSelected(file: File) {
    setPictureUploadProgress(0);
    setPictureError(null);
    try {
      // Uploading stages the file (and lets us preview it) - it isn't
      // attached to the account until Save is clicked, same as
      // IdentitySettingsForm.tsx's logo/favicon flow.
      const uploaded = await uploadFile(file, { onProgress: setPictureUploadProgress });
      setPendingPicture(uploaded);
    } catch (err) {
      setPictureError(errorMessage(err));
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
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields.username) {
        setUsernameError(err.fields.username);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const displayedPicture = pendingPicture !== undefined ? pendingPicture : user.profile_picture;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("editProfileTitle")}
      isDirty={isDirty}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            {commonT("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!isDirty} loading={isSaving}>
            {isSaving ? commonT("saving") : commonT("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-4">
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
            className="h-24 w-24 shrink-0"
          />
          <div className="min-w-0">
            <p className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("profilePictureLabel")}
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">
              {t("profilePictureHint", { maxSize: uploadLimitMb })}
            </p>
          </div>
        </div>
        {pictureError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {pictureError}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("firstNameLabel")}>
            <input className={INPUT_CLASS} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label={t("lastNameLabel")}>
            <input className={INPUT_CLASS} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>

        <Field label={t("titleLabel")}>
          <input
            className={INPUT_CLASS}
            placeholder={t("titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <Field label={t("usernameLabel")}>
          <input
            className={`${INPUT_CLASS} ${usernameError ? "!border-error focus:!border-error" : ""}`}
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
        </Field>

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block font-label-caps text-label-caps text-on-surface-variant uppercase">{label}</span>
      {children}
    </label>
  );
}
