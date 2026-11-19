#!/usr/bin/env python3
"""Fails when a runtime this repo pins is past end-of-life.

Vulnerability scanners (Trivy, Dependabot) only report *known CVEs*. A
release line that is past end-of-life gets no more fixes at all, so it stays
"clean" right up until something is found that will never be patched. This
check catches that case, using the endoflife.date API.

What it reads:
  * every third-party `image:` in docker-compose*.yml (postgres, redis, nginx)
  * the PYTHON_VERSION / NODE_VERSION build args in the two Dockerfiles

A version like `18` or `7` covers every release cycle under it (`7.2`, `7.4`
...): the check only fails once *all* of them are EOL, which matches pulling
the floating major tag. Tags with no version number (`stable-alpine`,
`latest`) are skipped - they always move to a supported line.

Usage:
    python scripts/check_eol.py          # exit 1 if anything is EOL
    python scripts/check_eol.py --warn-days 120
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Docker Hub image name -> endoflife.date product slug.
IMAGE_PRODUCTS = {
    "postgres": "postgresql",
    "redis": "redis",
    "nginx": "nginx",
}

# Dockerfile build arg -> endoflife.date product slug.
ARG_PRODUCTS = {
    ("backend/Dockerfile", "PYTHON_VERSION"): "python",
    ("frontend/Dockerfile", "NODE_VERSION"): "nodejs",
}


def pinned_versions() -> list[tuple[str, str, str]]:
    """(where, product, version) for everything this script knows how to check."""
    found: dict[tuple[str, str], str] = {}

    for compose in sorted(ROOT.glob("docker-compose*.yml")):
        for line in compose.read_text(encoding="utf-8").splitlines():
            match = re.match(r"\s*image:\s*([^\s#]+)", line)
            if not match or "${" in match.group(1):
                continue
            name, _, tag = match.group(1).partition(":")
            product = IMAGE_PRODUCTS.get(name)
            version = re.match(r"\d+(\.\d+)*", tag)
            if product and version:
                found[(product, version.group(0))] = f"{compose.name} ({match.group(1)})"

    for (path, arg), product in ARG_PRODUCTS.items():
        text = (ROOT / path).read_text(encoding="utf-8")
        match = re.search(rf"^ARG {arg}=(\S+)", text, re.MULTILINE)
        if match:
            found[(product, match.group(1))] = f"{path} ({arg}={match.group(1)})"

    return [(where, product, version) for (product, version), where in sorted(found.items())]


def fetch_cycles(product: str) -> list[dict]:
    request = urllib.request.Request(
        f"https://endoflife.date/api/{product}.json",
        headers={"User-Agent": "eol-check", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def eol_date(cycle: dict) -> dt.date | None:
    """The cycle's EOL date, or None when it has no announced end."""
    value = cycle.get("eol")
    if value is True:
        return dt.date.min
    if not value:
        return None
    return dt.date.fromisoformat(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--warn-days", type=int, default=90, help="warn this many days before EOL (default 90)")
    args = parser.parse_args()

    today = dt.date.today()
    failed = False

    for where, product, version in pinned_versions():
        try:
            cycles = fetch_cycles(product)
        except Exception as exc:  # network/API trouble shouldn't hide the rest
            print(f"?  {product} {version}: could not query endoflife.date ({exc}) - {where}")
            continue

        matching = [c for c in cycles if str(c["cycle"]) == version or str(c["cycle"]).startswith(version + ".")]
        if not matching:
            print(f"?  {product} {version}: no such release cycle on endoflife.date - {where}")
            continue

        ends = [eol_date(c) for c in matching]
        if any(end is None for end in ends):
            print(f"ok {product} {version}: supported, no end date announced - {where}")
            continue

        last = max(ends)
        if last <= today:
            when = "" if last == dt.date.min else f" since {last}"
            print(f"EOL {product} {version}: end-of-life{when}, no more fixes - {where}")
            failed = True
        elif (last - today).days <= args.warn_days:
            print(f"!  {product} {version}: end-of-life on {last} ({(last - today).days} days) - {where}")
        else:
            print(f"ok {product} {version}: supported until {last} - {where}")

    if failed:
        print("\nMove the lines marked EOL to a supported release (see https://endoflife.date).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
