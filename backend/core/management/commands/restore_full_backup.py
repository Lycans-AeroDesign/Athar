import os
import subprocess
import tarfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Whole-instance restore for whoever operates this deployment - the "
        "counterpart to create_full_backup. Wipes and replaces every "
        "organization's data with the contents of a pg_dump produced by "
        "that command (pg_restore --clean --if-exists), and optionally "
        "replaces the local media directory from its matching tar.gz. "
        "CLI-only by design, same reasoning as create_full_backup: this is "
        "an instance-wide, all-organizations operation with no "
        "organization.manage-equivalent permission that could safely gate "
        "a web endpoint for it."
    )

    def add_arguments(self, parser):
        parser.add_argument("dump_path", help="Path to the .dump file produced by create_full_backup.")
        parser.add_argument(
            "--media-archive-path",
            default=None,
            help="Path to the matching athar-media-*.tar.gz to also restore (optional).",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Required to actually run - this wipes and replaces every organization's data.",
        )

    def handle(self, *args, **options):
        dump_path = Path(options["dump_path"])
        if not dump_path.exists():
            raise CommandError(f"No such file: {dump_path}")

        media_archive_path = Path(options["media_archive_path"]) if options["media_archive_path"] else None
        if media_archive_path and not media_archive_path.exists():
            raise CommandError(f"No such file: {media_archive_path}")

        if not options["yes"]:
            raise CommandError(
                "This wipes and replaces EVERY organization's data in this database "
                f"with the contents of {dump_path}. Re-run with --yes to confirm."
            )

        self._restore_database(dump_path)
        self._restore_media(media_archive_path)

        self.stdout.write(self.style.SUCCESS("Full-instance restore complete."))

    def _restore_database(self, dump_path: Path) -> None:
        db = settings.DATABASES["default"]
        self.stdout.write(f"Restoring database from {dump_path} ...")

        # --clean --if-exists drops each object immediately before recreating
        # it (rather than requiring an empty database up front), --no-owner
        # skips ownership statements that could fail if the dump's original
        # role doesn't exist in this environment.
        command = [
            "pg_restore",
            "-h", db.get("HOST") or "localhost",
            "-p", str(db.get("PORT") or 5432),
            "-U", db.get("USER") or "",
            "-d", db["NAME"],
            "--clean",
            "--if-exists",
            "--no-owner",
            str(dump_path),
        ]
        env = {**os.environ, "PGPASSWORD": db.get("PASSWORD") or ""}
        try:
            subprocess.run(command, env=env, check=True, capture_output=True, text=True)
        except FileNotFoundError as exc:
            raise CommandError(
                "pg_restore isn't installed in this image - add the postgresql-client "
                "package to backend/Dockerfile."
            ) from exc
        except subprocess.CalledProcessError as exc:
            raise CommandError(f"pg_restore failed:\n{exc.stderr}") from exc

        self.stdout.write(self.style.SUCCESS("Database restored."))

    def _restore_media(self, media_archive_path: Path | None) -> None:
        if getattr(settings, "AWS_STORAGE_BUCKET_NAME", ""):
            self.stdout.write(
                self.style.WARNING(
                    "File storage is S3-compatible (AWS_STORAGE_BUCKET_NAME is set) - "
                    "uploaded files live in that bucket, not on local disk, so this "
                    "command doesn't restore them. Use your storage provider's own "
                    "backup/versioning features for that instead."
                )
            )
            return

        if media_archive_path is None:
            self.stdout.write("No --media-archive-path given - leaving the local media directory untouched.")
            return

        media_root = Path(settings.MEDIA_ROOT)
        self.stdout.write(f"Restoring media directory from {media_archive_path} ...")
        media_root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(media_archive_path, "r:gz") as tar:
            tar.extractall(media_root.parent, filter="data")
        self.stdout.write(self.style.SUCCESS(f"Media directory restored to {media_root}"))
