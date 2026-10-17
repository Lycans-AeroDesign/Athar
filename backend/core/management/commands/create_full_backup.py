import os
import subprocess
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import crypto
from core.management.passphrase import add_passphrase_argument, resolve_passphrase


class Command(BaseCommand):
    help = (
        "Whole-instance backup for whoever operates this deployment - a full "
        "Postgres dump (every organization, via pg_dump) plus the local media "
        "directory when file storage isn't S3-backed. CLI-only by design: "
        "is_superuser is 'break-glass'/CLI-only everywhere else in this app "
        "(see accounts.User's own docstring), and Django admin itself isn't "
        "even registered outside DEBUG (see config/urls.py) - so this "
        "deliberately isn't a web endpoint, and never could leak one org's "
        "data to another the way a web-exposed 'download everything' route "
        "would risk. For one organization's own data (not the whole "
        "instance), an organization.manage holder can already do that "
        "themselves from Settings > Backups - see the backups app. Both "
        "files are encrypted with a passphrase (see core/crypto.py) - keep it "
        "somewhere safe, a backup can't be restored without it."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--output-dir",
            # Deliberately not "backups" - that's the `backups` Django app's
            # own source directory (backend/backups/), not an output folder.
            default=str(settings.BASE_DIR / "backup_archives"),
            help="Directory to write the dump/media archive into (default: BASE_DIR/backup_archives).",
        )
        add_passphrase_argument(parser)

    def handle(self, *args, **options):
        output_dir = Path(options["output_dir"])
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        passphrase = resolve_passphrase(options, confirm=True)

        self._dump_database(output_dir, timestamp, passphrase)
        self._archive_media(output_dir, timestamp, passphrase)

        self.stdout.write(self.style.SUCCESS(f"Full-instance backup complete - see {output_dir}"))

    def _dump_database(self, output_dir: Path, timestamp: str, passphrase: str) -> None:
        db = settings.DATABASES["default"]
        dump_path = output_dir / f"athar-db-{timestamp}.dump.enc"
        self.stdout.write(f"Dumping database to {dump_path} ...")

        # Custom format (-F c) - compressed and restorable with pg_restore
        # (including selectively, e.g. one table at a time), unlike a plain
        # SQL dump. Written to stdout and encrypted on the fly, so the
        # plaintext dump never touches disk.
        command = [
            "pg_dump",
            "-h", db.get("HOST") or "localhost",
            "-p", str(db.get("PORT") or 5432),
            "-U", db.get("USER") or "",
            "-F", "c",
            db["NAME"],
        ]
        env = {**os.environ, "PGPASSWORD": db.get("PASSWORD") or ""}
        try:
            with tempfile.TemporaryFile() as stderr, open(dump_path, "wb") as destination:
                try:
                    process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=stderr)
                except FileNotFoundError as exc:
                    raise CommandError(
                        "pg_dump isn't installed in this image - add the postgresql-client "
                        "package to backend/Dockerfile."
                    ) from exc
                try:
                    crypto.encrypt_file(process.stdout, destination, passphrase)
                except BaseException:
                    # An error mid-stream (e.g. disk full) - don't leave pg_dump
                    # blocked writing to a pipe nobody reads.
                    process.kill()
                    process.wait()
                    raise
                finally:
                    process.stdout.close()
                if process.wait() != 0:
                    stderr.seek(0)
                    raise CommandError(f"pg_dump failed:\n{stderr.read().decode(errors='replace')}")
        except BaseException:
            # Never leave a partial .enc behind looking like a usable backup.
            dump_path.unlink(missing_ok=True)
            raise

        self.stdout.write(self.style.SUCCESS(f"Database dump written to {dump_path}"))

    def _archive_media(self, output_dir: Path, timestamp: str, passphrase: str) -> None:
        if getattr(settings, "AWS_STORAGE_BUCKET_NAME", ""):
            self.stdout.write(
                self.style.WARNING(
                    "File storage is S3-compatible (AWS_STORAGE_BUCKET_NAME is set) - "
                    "uploaded files live in that bucket, not on local disk, so this "
                    "command doesn't back them up. Use your storage provider's own "
                    "backup/versioning features for that instead."
                )
            )
            return

        media_root = Path(settings.MEDIA_ROOT)
        if not media_root.exists() or not any(media_root.iterdir()):
            self.stdout.write("No media files found - nothing to archive.")
            return

        media_archive_path = output_dir / f"athar-media-{timestamp}.tar.gz.enc"
        self.stdout.write(f"Archiving media directory to {media_archive_path} ...")
        with tempfile.TemporaryFile() as plaintext:
            with tarfile.open(fileobj=plaintext, mode="w:gz") as tar:
                tar.add(media_root, arcname="media")
            plaintext.seek(0)
            with open(media_archive_path, "wb") as destination:
                crypto.encrypt_file(plaintext, destination, passphrase)
        self.stdout.write(self.style.SUCCESS(f"Media archive written to {media_archive_path}"))
