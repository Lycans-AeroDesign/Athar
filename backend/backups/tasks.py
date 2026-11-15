import logging

from celery import shared_task
from django.utils import timezone

from . import restore, services
from .models import BackupJob, RestoreJob

logger = logging.getLogger(__name__)


# Longer than the global task limits, but kept under BACKUP_JOB_STALE_AFTER_HOURS
# (6h): the soft limit lands in the task's except-block (job -> FAILED with a
# message); a hard kill leaves the job RUNNING for fail_stale_jobs to collect.
_LONG_TASK_LIMITS = {"soft_time_limit": 5 * 3600, "time_limit": int(5.5 * 3600)}


@shared_task(**_LONG_TASK_LIMITS)
def generate_org_backup(job_id) -> None:
    """Runs build_org_backup_archive in the background (see BackupJob) -
    triggered by BackupJobListCreateView.post, polled via
    BackupJobDetailView, downloaded via BackupJobDownloadView once DONE."""
    try:
        job = BackupJob.objects.select_related("organization").get(pk=job_id)
    except BackupJob.DoesNotExist:
        logger.warning("generate_org_backup: job %s no longer exists", job_id)
        return

    if job.status != BackupJob.Status.PENDING:
        # A duplicate delivery, or a job already marked FAILED as stale.
        logger.warning("generate_org_backup: job %s is %s, not PENDING - skipping", job_id, job.status)
        return
    job.status = BackupJob.Status.RUNNING
    job.save(update_fields=["status", "updated_at"])

    try:
        services.build_org_backup_archive(job)
    except Exception as exc:  # noqa: BLE001 - any failure here must land the job in FAILED, not crash the worker
        logger.exception("generate_org_backup failed for job %s", job_id)
        job.status = BackupJob.Status.FAILED
        job.error = str(exc)[:2000]
        job.save(update_fields=["status", "error", "updated_at"])
        return

    job.status = BackupJob.Status.DONE
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "completed_at", "archive", "updated_at"])


def _discard_uploaded_archive(job: RestoreJob) -> None:
    if job.uploaded_archive:
        job.uploaded_archive.delete(save=False)
        job.save(update_fields=["uploaded_archive", "updated_at"])


@shared_task(**_LONG_TASK_LIMITS)
def restore_org_backup(restore_job_id) -> None:
    """Runs restore.restore_org_backup_archive in the background (see
    RestoreJob) - triggered by RestoreJobListCreateView.post, polled via
    RestoreJobDetailView."""
    try:
        job = RestoreJob.objects.select_related("organization", "source_backup", "requested_by").get(pk=restore_job_id)
    except RestoreJob.DoesNotExist:
        logger.warning("restore_org_backup: job %s no longer exists", restore_job_id)
        return

    if job.status != RestoreJob.Status.PENDING:
        logger.warning("restore_org_backup: job %s is %s, not PENDING - skipping", restore_job_id, job.status)
        return
    job.status = RestoreJob.Status.RUNNING
    job.save(update_fields=["status", "updated_at"])

    archive = job.uploaded_archive if job.uploaded_archive else job.source_backup and job.source_backup.archive
    try:
        if not archive:
            raise restore.RestoreError("The backup this restore was started from no longer exists.")
        with services.open_decrypted_archive(archive) as archive_file:
            summary = restore.restore_org_backup_archive(job.organization, archive_file, actor=job.requested_by)
    except Exception as exc:  # noqa: BLE001 - any failure here must land the job in FAILED, not crash the worker
        logger.exception("restore_org_backup failed for job %s", restore_job_id)
        job.status = RestoreJob.Status.FAILED
        job.error = str(exc)[:2000]
        job.save(update_fields=["status", "error", "updated_at"])
        return
    finally:
        _discard_uploaded_archive(job)

    job.status = RestoreJob.Status.DONE
    job.summary = summary.as_dict()
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "summary", "completed_at", "updated_at"])


@shared_task
def fail_stale_jobs() -> int:
    """Hourly (CELERY_BEAT_SCHEDULE) - see services.fail_stale_jobs."""
    return services.fail_stale_jobs()
