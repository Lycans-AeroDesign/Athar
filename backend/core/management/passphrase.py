"""Where create_full_backup/restore_full_backup get their encryption
passphrase from - shared so the two can't disagree about it."""

import getpass
import os
import sys
from pathlib import Path

from django.conf import settings
from django.core.management.base import CommandError


def add_passphrase_argument(parser) -> None:
    parser.add_argument(
        "--passphrase-file",
        default=None,
        help=(
            "File containing the backup passphrase (first line). Otherwise read from the "
            "BACKUP_PASSPHRASE environment variable, or prompted for interactively."
        ),
    )


def resolve_passphrase(options, confirm: bool) -> str:
    if options.get("passphrase_file"):
        path = Path(options["passphrase_file"])
        if not path.exists():
            raise CommandError(f"No such file: {path}")
        passphrase = next(iter(path.read_text(encoding="utf-8").splitlines()), "")
    elif os.environ.get("BACKUP_PASSPHRASE"):
        passphrase = os.environ["BACKUP_PASSPHRASE"]
    elif sys.stdin.isatty():
        passphrase = getpass.getpass("Backup passphrase: ")
        if confirm and getpass.getpass("Repeat passphrase: ") != passphrase:
            raise CommandError("The passphrases don't match.")
    else:
        raise CommandError(
            "No passphrase given - pass --passphrase-file, set BACKUP_PASSPHRASE, or run interactively."
        )
    if confirm and len(passphrase) < settings.BACKUP_PASSPHRASE_MIN_LENGTH:
        raise CommandError(f"The passphrase must be at least {settings.BACKUP_PASSPHRASE_MIN_LENGTH} characters.")
    return passphrase
