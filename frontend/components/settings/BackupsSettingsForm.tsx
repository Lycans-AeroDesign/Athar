"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { ListSkeleton } from "@/components/ui/Skeleton";
import {
  BACKUP_PASSPHRASE_MIN_LENGTH,
  createBackupJob,
  createRestoreJob,
  deleteBackupJob,
  downloadBackupJob,
  getBackupJob,
  getBackupJobs,
  getRestoreJob,
  getRestoreJobs,
  uploadRestoreArchive,
} from "@/lib/api/backups";
import type { BackupJob, RestoreJob } from "@/lib/api/types";
import { formatDateTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

const POLL_INTERVAL_MS = 2000;

const STATUS_CLASSES: Record<BackupJob["status"], string> = {
  PENDING: "bg-surface-container-high text-on-surface-variant",
  RUNNING: "bg-tertiary-container text-on-tertiary-container",
  DONE: "bg-secondary-container text-on-secondary-container",
  FAILED: "bg-error-container text-on-error-container",
};

// Rendered only when the viewer has organization.manage (see settings/page.tsx),
// which also gates every backups/ endpoint - see backend/backups/views.py's
// BACKUP_PERMISSION. Each backup runs as a background Celery task
// (backups.tasks.generate_org_backup) - creating one just enqueues it, so
// this polls in-progress jobs until they land on DONE/FAILED.
export function BackupsSettingsForm() {
  const t = useTranslations("settings.backups");
  const commonT = useTranslations("common");

  const [jobs, setJobs] = useState<BackupJob[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [restoreJobs, setRestoreJobs] = useState<RestoreJob[] | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupJob | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restorePollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPassphrase, setUploadPassphrase] = useState("");

  // Downloads are encrypted with a passphrase the admin picks here - the only
  // thing needed to restore the file on another server later.
  const [downloadTarget, setDownloadTarget] = useState<BackupJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupJob | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  // A plaintext .zip is a backup downloaded before encryption existed - it
  // restores without a passphrase.
  const uploadNeedsPassphrase = uploadTarget !== null && !uploadTarget.name.toLowerCase().endsWith(".zip");

  useEffect(() => {
    getBackupJobs().then(setJobs);
    getRestoreJobs().then(setRestoreJobs);
    return () => {
      if (pollTimeout.current) clearTimeout(pollTimeout.current);
      if (restorePollTimeout.current) clearTimeout(restorePollTimeout.current);
    };
  }, []);

  function pollJob(jobId: string) {
    pollTimeout.current = setTimeout(async () => {
      const updated = await getBackupJob(jobId);
      setJobs((prev) => (prev ?? []).map((j) => (j.id === updated.id ? updated : j)));
      if (updated.status === "PENDING" || updated.status === "RUNNING") {
        pollJob(jobId);
      }
    }, POLL_INTERVAL_MS);
  }

  function pollRestoreJob(jobId: string) {
    restorePollTimeout.current = setTimeout(async () => {
      const updated = await getRestoreJob(jobId);
      setRestoreJobs((prev) => (prev ?? []).map((j) => (j.id === updated.id ? updated : j)));
      if (updated.status === "PENDING" || updated.status === "RUNNING") {
        pollRestoreJob(jobId);
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleCreate() {
    setIsCreating(true);
    setError(null);
    try {
      const job = await createBackupJob();
      setJobs((prev) => [job, ...(prev ?? [])]);
      pollJob(job.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsCreating(false);
    }
  }

  function openDownload(job: BackupJob) {
    // Cleared on open rather than after each attempt, so a cancelled save
    // dialog or a failed download can be retried without retyping it.
    setDownloadTarget(job);
    setPassphrase("");
    setPassphraseConfirm("");
    setDownloadError(null);
  }

  async function handleDownload() {
    if (!downloadTarget) return;
    if (passphrase.length < BACKUP_PASSPHRASE_MIN_LENGTH) {
      setDownloadError(t("passphraseTooShort", { min: BACKUP_PASSPHRASE_MIN_LENGTH }));
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setDownloadError(t("passphraseMismatch"));
      return;
    }
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const saved = await downloadBackupJob(
        downloadTarget.id,
        passphrase,
        `backup-${downloadTarget.created_at.slice(0, 10)}.athar`,
      );
      // Cancelling the browser's save dialog keeps the modal open to retry.
      if (saved) setDownloadTarget(null);
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteBackupJob(deleteTarget.id);
      setJobs((prev) => (prev ?? []).filter((j) => j.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleConfirmRestore() {
    if (!restoreTarget) return;
    setRestoreError(null);
    try {
      const job = await createRestoreJob(restoreTarget.id);
      setRestoreJobs((prev) => [job, ...(prev ?? [])]);
      pollRestoreJob(job.id);
    } catch (err) {
      setRestoreError(errorMessage(err));
    }
  }

  async function handleConfirmUpload() {
    if (!uploadTarget) return;
    const file = uploadTarget;
    const filePassphrase = uploadNeedsPassphrase ? uploadPassphrase : "";
    setUploadTarget(null);
    setUploadPassphrase("");
    setRestoreError(null);
    setUploadProgress(0);
    try {
      const job = await uploadRestoreArchive(file, filePassphrase, setUploadProgress);
      setRestoreJobs((prev) => [job, ...(prev ?? [])]);
      pollRestoreJob(job.id);
    } catch (err) {
      setRestoreError(errorMessage(err));
    } finally {
      setUploadProgress(null);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
            <p className="font-body-md text-body-md text-on-surface-variant mt-2 flex items-start gap-1.5">
              <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
              {t("sensitiveNote")}
            </p>
          </div>
          <Button onClick={handleCreate} disabled={isCreating} className="shrink-0">
            <Icon name="download" size={18} />
            {isCreating ? commonT("working") : t("createButton")}
          </Button>
        </div>

        {!jobs ? (
          <ListSkeleton rows={3} compact />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="archive"
            message={t("emptyState")}
            action={
              <Button onClick={handleCreate} disabled={isCreating}>
                <Icon name="download" size={18} />
                {isCreating ? commonT("working") : t("createButton")}
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 px-3 py-2 rounded-lg bg-surface-container"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-body-md text-body-md text-on-surface">{formatDateTime(job.created_at)}</span>
                    <span
                      className={`font-label-caps text-label-caps uppercase rounded-full px-2 py-0.5 ${STATUS_CLASSES[job.status]}`}
                    >
                      {t(`status${job.status}`)}
                    </span>
                  </div>
                  {job.requested_by && (
                    <p className="font-body-md text-body-md text-on-surface-variant truncate">
                      {t("requestedBy", { email: job.requested_by })}
                    </p>
                  )}
                  {job.status === "FAILED" && job.error && (
                    <p className="font-body-md text-body-md text-error break-words sm:truncate">{job.error}</p>
                  )}
                </div>
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                  {job.can_download && (
                    <>
                      <Button variant="secondary" onClick={() => openDownload(job)}>
                        <Icon name="download" size={16} />
                        {t("downloadButton")}
                      </Button>
                      <Button variant="secondary" onClick={() => setRestoreTarget(job)}>
                        <Icon name="unarchive" size={16} />
                        {t("restoreButton")}
                      </Button>
                    </>
                  )}
                  {job.status !== "RUNNING" && (
                    <Button variant="danger" onClick={() => setDeleteTarget(job)}>
                      <Icon name="delete" size={16} />
                      {t("deleteButton")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("restoresTitle")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("uploadHint")}</p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".athar,.zip,application/zip,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setUploadTarget(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={uploadProgress !== null}
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" size={18} />
            {uploadProgress !== null
              ? t("uploading", { percent: Math.round(uploadProgress * 100) })
              : t("uploadButton")}
          </Button>
        </div>

        {!restoreJobs ? (
          <ListSkeleton rows={2} compact />
        ) : restoreJobs.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("restoresEmptyState")}</p>
        ) : (
          <ul className="space-y-1">
            {restoreJobs.map((job) => (
              <li key={job.id} className="px-3 py-2 rounded-lg bg-surface-container space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-body-md text-body-md text-on-surface">{formatDateTime(job.created_at)}</span>
                  <span
                    className={`font-label-caps text-label-caps uppercase rounded-full px-2 py-0.5 ${STATUS_CLASSES[job.status]}`}
                  >
                    {t(`status${job.status}`)}
                  </span>
                </div>
                {job.uploaded_filename && (
                  <p className="font-body-md text-body-md text-on-surface-variant break-all">
                    {t("restoreFromUpload", { name: job.uploaded_filename })}
                  </p>
                )}
                {job.requested_by && (
                  <p className="font-body-md text-body-md text-on-surface-variant truncate">
                    {t("requestedBy", { email: job.requested_by })}
                  </p>
                )}
                {job.status === "FAILED" && job.error && (
                  <p className="font-body-md text-body-md text-error break-words sm:truncate">{job.error}</p>
                )}
                {job.status === "DONE" && "orphaned_user_refs" in job.summary && (
                  <>
                    {(job.summary.deactivated_users ?? 0) > 0 && (
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {t("restoreSummaryDeactivatedUsers", { count: job.summary.deactivated_users ?? 0 })}
                      </p>
                    )}
                    {(job.summary.users_without_password ?? 0) > 0 && (
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {t("restoreSummaryUsersWithoutPassword", { count: job.summary.users_without_password ?? 0 })}
                      </p>
                    )}
                    {job.summary.orphaned_user_refs > 0 && (
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {t("restoreSummaryOrphanedUsers", { count: job.summary.orphaned_user_refs })}
                      </p>
                    )}
                    {job.summary.missing_files > 0 && (
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {t("restoreSummaryMissingFiles", { count: job.summary.missing_files })}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {restoreError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {restoreError}
          </p>
        )}
      </div>

      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDescription")}
        confirmLabel={isDeleting ? commonT("working") : t("deleteConfirmButton")}
        danger
        onConfirm={handleConfirmDelete}
      />

      <ConfirmModal
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title={t("restoreConfirmTitle")}
        description={t("restoreConfirmDescription")}
        confirmLabel={t("restoreConfirmButton")}
        danger
        onConfirm={handleConfirmRestore}
      />

      <Modal
        open={downloadTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDownloadTarget(null);
        }}
        title={t("downloadTitle")}
        description={t("downloadDescription")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDownloadTarget(null)}>
              {commonT("cancel")}
            </Button>
            <Button type="submit" form="backup-download-form" disabled={isDownloading}>
              <Icon name="download" size={16} />
              {isDownloading ? commonT("working") : t("downloadButton")}
            </Button>
          </>
        }
      >
        <form
          id="backup-download-form"
          noValidate
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            handleDownload();
          }}
        >
          <FloatingLabelInput
            type="password"
            autoComplete="new-password"
            icon="lock"
            label={t("passphraseLabel")}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            hint={t("passphraseHint", { min: BACKUP_PASSPHRASE_MIN_LENGTH })}
          />
          <FloatingLabelInput
            type="password"
            autoComplete="new-password"
            icon="lock"
            label={t("passphraseConfirmLabel")}
            value={passphraseConfirm}
            onChange={(e) => setPassphraseConfirm(e.target.value)}
          />
          <p className="font-body-md text-body-md text-on-surface-variant flex items-start gap-1.5">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            {t("passphraseWarning")}
          </p>
          {downloadError && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {downloadError}
            </p>
          )}
        </form>
      </Modal>

      <Modal
        open={uploadTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUploadTarget(null);
            setUploadPassphrase("");
          }
        }}
        title={t("uploadConfirmTitle", { name: uploadTarget?.name ?? "" })}
        description={t("restoreConfirmDescription")}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setUploadTarget(null);
                setUploadPassphrase("");
              }}
            >
              {commonT("cancel")}
            </Button>
            <Button
              type="submit"
              form="backup-upload-form"
              variant="danger"
              disabled={uploadNeedsPassphrase && uploadPassphrase.length === 0}
            >
              {t("restoreConfirmButton")}
            </Button>
          </>
        }
      >
        <form
          id="backup-upload-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirmUpload();
          }}
        >
          {uploadNeedsPassphrase ? (
            <FloatingLabelInput
              type="password"
              autoComplete="off"
              icon="lock"
              label={t("passphraseLabel")}
              value={uploadPassphrase}
              onChange={(e) => setUploadPassphrase(e.target.value)}
              hint={t("uploadPassphraseHint")}
            />
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("uploadLegacyNote")}</p>
          )}
        </form>
      </Modal>
    </div>
  );
}
