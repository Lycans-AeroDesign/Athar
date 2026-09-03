import logging

from celery import shared_task
from django.utils import timezone

from . import restore, services
from .models import BackupJob, RestoreJob

logger = logging.getLogger(__name__)


@shared_task
def generate_org_backup(job_id) -> None:
    """Runs build_org_backup_archive in the background (see BackupJob) -
    triggered by BackupJobListCreateView.post, polled via
    BackupJobDetailView, downloaded via BackupJobDownloadView once DONE."""
    try:
        job = BackupJob.objects.select_related("organization").get(pk=job_id)
    except BackupJob.DoesNotExist:
        logger.warning("generate_org_backup: job %s no longer exists", job_id)
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


@shared_task
def restore_org_backup(restore_job_id) -> None:
    """Runs restore.restore_org_backup_archive in the background (see
    RestoreJob) - triggered by RestoreJobListCreateView.post, polled via
    RestoreJobDetailView."""
    try:
        job = RestoreJob.objects.select_related("organization", "source_backup").get(pk=restore_job_id)
    except RestoreJob.DoesNotExist:
        logger.warning("restore_org_backup: job %s no longer exists", restore_job_id)
        return

    job.status = RestoreJob.Status.RUNNING
    job.save(update_fields=["status", "updated_at"])

    try:
        with job.source_backup.archive.open("rb") as archive_file:
            summary = restore.restore_org_backup_archive(job.organization, archive_file)
    except Exception as exc:  # noqa: BLE001 - any failure here must land the job in FAILED, not crash the worker
        logger.exception("restore_org_backup failed for job %s", restore_job_id)
        job.status = RestoreJob.Status.FAILED
        job.error = str(exc)[:2000]
        job.save(update_fields=["status", "error", "updated_at"])
        return

    job.status = RestoreJob.Status.DONE
    job.summary = summary.as_dict()
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "summary", "completed_at", "updated_at"])
