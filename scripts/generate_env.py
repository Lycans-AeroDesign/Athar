#!/usr/bin/env python3
"""Generates local .env files (root, backend/, frontend/) from their
.env.example templates, filling in randomly generated secrets.

Usage:
    python scripts/generate_env.py           # skip files that already exist
    python scripts/generate_env.py --force   # regenerate and overwrite everything

.env files are gitignored - this only touches local, untracked files.
"""

from __future__ import annotations

import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORCE = "--force" in sys.argv[1:]

# No `$`, backtick, backslash, or `"` - scripts/init_letsencrypt.sh does
# `source .env`, and those four stay special even inside the double quotes
# write_env() wraps every value in below (unlike `(`, `)`, `&`, `*`, `!`,
# `#`, which double quotes neutralize fine).
DJANGO_SECRET_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%^&*(-_=+)"
PASSWORD_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def random_string(length: int, chars: str) -> str:
    return "".join(secrets.choice(chars) for _ in range(length))


def generate_secret_key() -> str:
    return random_string(50, DJANGO_SECRET_CHARS)


def generate_password() -> str:
    return random_string(24, PASSWORD_CHARS)


def write_env(directory: Path, replacements: dict[str, str]) -> None:
    example_path = directory / ".env.example"
    env_path = directory / ".env"
    label = env_path.relative_to(ROOT).as_posix()

    if not example_path.exists():
        print(f"skip    {label} (no .env.example found)")
        return
    if env_path.exists() and not FORCE:
        print(f"skip    {label} (already exists, use --force to overwrite)")
        return

    content = example_path.read_text(encoding="utf-8")
    for key, value in replacements.items():
        pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
        if pattern.search(content):
            # Quoted so shell-special characters in the generated value
            # (see DJANGO_SECRET_CHARS above) are inert wherever this file
            # gets read - `source .env`, Docker Compose, etc. A lambda
            # replacement (not a plain string) avoids re.sub treating a
            # stray `\` in the value as a backreference.
            content = pattern.sub(lambda _m: f'{key}="{value}"', content)

    env_path.write_text(content, encoding="utf-8")
    print(f"created {label}")


def main() -> None:
    secret_key = generate_secret_key()
    postgres_password = generate_password()

    # Root .env drives docker-compose directly (SECRET_KEY / POSTGRES_PASSWORD
    # are interpolated straight into the backend/db service environment).
    write_env(
        ROOT,
        {
            "SECRET_KEY": secret_key,
            "POSTGRES_PASSWORD": postgres_password,
        },
    )

    # backend/.env is only read for non-docker (bare manage.py) runs; only the
    # secret key needs a real value, DATABASE_URL stays as the documented example.
    write_env(ROOT / "backend", {"SECRET_KEY": secret_key})

    # frontend/.env has no secrets to generate, just copy the template through.
    write_env(ROOT / "frontend", {})

    print("\nDone. Review the generated .env files before running docker compose / manage.py.")


if __name__ == "__main__":
    main()
