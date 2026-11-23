#!/usr/bin/env python3
"""Validate migration idempotence and baseline data retention in Docker."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROJECT = os.environ.get("COMPOSE_PROJECT", "stpt-integrity-test")
COMPOSE = ["docker", "compose", "-p", PROJECT, "-f", "deploy/docker-compose.yml"]
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "szyca")


def psql(query: str) -> str:
    result = subprocess.run(
        [
            *COMPOSE,
            "exec",
            "-T",
            "szyca",
            "env",
            f"PGPASSWORD={PG_PASSWORD}",
            "psql",
            "-h",
            "127.0.0.1",
            "-U",
            "szyca",
            "-d",
            "szyca",
            "-Atc",
            query,
        ],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def wait_ready(timeout: int = 60) -> None:
    port = os.environ.get("WEB_PORT", "8091")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://localhost:{port}/readyz", timeout=2) as resp:
                if resp.status == 200:
                    return
        except OSError:
            pass
        time.sleep(1)
    raise TimeoutError("container did not become ready")


def data_counts() -> dict[str, int]:
    raw = psql(
        """
        SELECT json_build_object(
          'users', (SELECT count(*) FROM users),
          'questions', (SELECT count(*) FROM questions),
          'attempts', (SELECT count(*) FROM attempts),
          'qrcodes', (SELECT count(*) FROM qrcodes),
          'backgrounds', (SELECT count(*) FROM backgrounds),
          'sections', (SELECT count(*) FROM home_sections),
          'gallery_images', (SELECT count(*) FROM gallery_images)
        )
        """
    )
    return json.loads(raw)


def main() -> None:
    wait_ready()
    versions = psql("SELECT version FROM schema_migrations ORDER BY version").splitlines()
    assert versions == [
        "0001_quiz_baseline.sql",
        "0002_site_access_media.sql",
        "0003_lottery.sql",
        "0004_section_plugins.sql",
        "0005_gallery.sql",
        "202611240001_screen_section.sql",
    ], versions
    assert psql(
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'home_sections' AND column_name = 'plugin_version'"
    ) == "1"
    assert psql(
        "SELECT count(*) FROM pg_constraint WHERE conname = 'home_sections_kind_check'"
    ) == "0"
    assert psql(
        "SELECT plugin_version FROM home_sections WHERE kind = 'gallery' LIMIT 1"
    ) == "2"

    before = data_counts()
    container_id = subprocess.run(
        [*COMPOSE, "ps", "-q", "szyca"],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
    assert container_id, "compose service container not found"
    subprocess.run(["docker", "restart", container_id], cwd=ROOT, check=True, capture_output=True)
    wait_ready()

    after = data_counts()
    assert before == after, f"data changed across restart: {before} != {after}"
    versions_after = psql("SELECT version FROM schema_migrations ORDER BY version").splitlines()
    assert versions_after == versions, "migrations were applied twice"
    print(
        "migration ok: six versions applied once; restart retained "
        + json.dumps(after, ensure_ascii=False, sort_keys=True)
    )


if __name__ == "__main__":
    main()
