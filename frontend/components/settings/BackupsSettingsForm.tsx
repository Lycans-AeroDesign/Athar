"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import {
  createBackupJob,
  createRestoreJob,
  downloadBackupJob,
  getBackupJob,
  getBackupJobs,
  getRestoreJob,
  getRestoreJobs,
} from "@/lib/api/backups";
import type { BackupJob, RestoreJob } from "@/lib/api/types";
import { formatDateTime } from "@/lib/datetime";

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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDownload(job: BackupJob) {
    try {
      await downloadBackupJob(job.id, `backup-${job.created_at.slice(0, 10)}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setRestoreError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
          </div>
          <Button onClick={handleCreate} disabled={isCreating}>
            <Icon name="download" size={18} />
            {isCreating ? commonT("working") : t("createButton")}
          </Button>
        </div>

        {!jobs ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : jobs.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <ul className="space-y-1">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-container"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
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
                    <p className="font-body-md text-body-md text-error truncate">{job.error}</p>
                  )}
                </div>
                {job.can_download && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="secondary" onClick={() => handleDownload(job)}>
                      <Icon name="download" size={16} />
                      {t("downloadButton")}
                    </Button>
                    <Button variant="danger" onClick={() => setRestoreTarget(job)}>
                      <Icon name="unarchive" size={16} />
                      {t("restoreButton")}
                    </Button>
                  </div>
                )}
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

      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("restoresTitle")}</h2>

        {!restoreJobs ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : restoreJobs.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("restoresEmptyState")}</p>
        ) : (
          <ul className="space-y-1">
            {restoreJobs.map((job) => (
              <li key={job.id} className="px-3 py-2 rounded-lg bg-surface-container space-y-1">
                <div className="flex items-center gap-2">
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
                  <p className="font-body-md text-body-md text-error truncate">{job.error}</p>
                )}
                {job.status === "DONE" && "orphaned_user_refs" in job.summary && (
                  <>
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
    </div>
  );
}
