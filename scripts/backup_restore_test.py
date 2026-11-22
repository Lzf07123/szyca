#!/usr/bin/env python3
"""Exercise full /data volume backup and restore through two isolated stacks."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMAGE = os.environ.get("TEST_IMAGE", "szyca:release-test")
SOURCE_PROJECT = "szyca-backup-src"
TARGET_PROJECT = "szyca-backup-dst"
SOURCE_VOLUME = f"{SOURCE_PROJECT}_data"
TARGET_VOLUME = f"{TARGET_PROJECT}_data"
ADMIN_PASSWORD = "backup-test-password"


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True, **kwargs)


def compose(project: str, port: int, action: str) -> None:
    env = os.environ.copy()
    env.update({
        "COMPOSE_PROJECT_NAME": project,
        "SZYCA_IMAGE": IMAGE,
        "SZYCA_PULL_POLICY": "never",
        "WEB_PORT": str(port),
        "ADMIN_PASSWORD": ADMIN_PASSWORD,
        "POSTGRES_PASSWORD": "szyca",
        "LEGACY_ADMIN_TOKEN_ENABLED": "false",
    })
    args = [
        "docker", "compose", "-p", project,
        "-f", "deploy/docker-compose.yml",
        action,
    ]
    if action == "up":
        args.append("-d")
    run(args, env=env)


def wait_ready(port: int) -> None:
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://localhost:{port}/readyz", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(1)
    raise TimeoutError(f"port {port} did not become ready")


def psql(query: str) -> str:
    return run([
        "docker", "compose", "-p", SOURCE_PROJECT,
        "-f", "deploy/docker-compose.yml", "exec", "-T", "szyca",
        "env", "PGPASSWORD=szyca", "psql", "-h", "127.0.0.1",
        "-U", "szyca", "-d", "szyca", "-Atc", query,
    ]).stdout.strip()


def cleanup() -> None:
    for project in (SOURCE_PROJECT, TARGET_PROJECT):
        env = os.environ.copy()
        env.update({"SZYCA_IMAGE": IMAGE, "SZYCA_PULL_POLICY": "never"})
        subprocess.run(
            [
                "docker", "compose", "-p", project,
                "-f", "deploy/docker-compose.yml", "down",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    for volume in (SOURCE_VOLUME, TARGET_VOLUME):
        subprocess.run(
            ["docker", "volume", "rm", volume],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    existing = run([
        "docker", "ps", "-a", "--filter", "name=^/szyca$", "--format", "{{.Names}}",
    ]).stdout.strip()
    if existing:
        raise RuntimeError("container named szyca exists; stop it before the restore drill")
    cleanup()
    archive_dir = Path(tempfile.mkdtemp(prefix="szyca-backup-"))
    try:
        compose(SOURCE_PROJECT, 8096, "up")
        wait_ready(8096)
        psql("""
            INSERT INTO app_meta (k, v) VALUES ('backup_restore_marker', 'preserved')
            ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
        """)
        run([
            "docker", "exec", "szyca", "sh", "-c",
            "printf 'upload-preserved\\n' > /data/uploads/backup-marker.txt",
        ])

        # Stop the application but keep its named data volume for the snapshot.
        compose(SOURCE_PROJECT, 8096, "down")
        run([
            "docker", "run", "--rm",
            "-v", f"{SOURCE_VOLUME}:/data:ro",
            "-v", f"{archive_dir}:/backup",
            "alpine:3.20",
            "tar", "-czf", "/backup/data.tgz", "-C", "/data", ".",
        ])
        archive_size = (archive_dir / "data.tgz").stat().st_size
        assert archive_size > 0

        run(["docker", "volume", "create", TARGET_VOLUME])
        run([
            "docker", "run", "--rm",
            "-v", f"{TARGET_VOLUME}:/data",
            "-v", f"{archive_dir}:/backup:ro",
            "alpine:3.20",
            "tar", "-xzf", "/backup/data.tgz", "-C", "/data",
        ])
        compose(TARGET_PROJECT, 8097, "up")
        wait_ready(8097)

        marker = run([
            "docker", "exec", "szyca",
            "env", "PGPASSWORD=szyca", "psql", "-h", "127.0.0.1",
            "-U", "szyca", "-d", "szyca", "-Atc",
            "SELECT v FROM app_meta WHERE k = 'backup_restore_marker'",
        ]).stdout.strip()
        assert marker == "preserved", marker
        upload = run([
            "docker", "exec", "szyca", "cat", "/data/uploads/backup-marker.txt",
        ]).stdout.strip()
        assert upload == "upload-preserved", upload
        health = run([
            "docker", "exec", "szyca", "wget", "-qO-", "http://127.0.0.1:8080/readyz",
        ]).stdout.strip()
        assert '"status":"ready"' in health, health

        print(
            "backup restore ok: full /data archive restored to a new stack; "
            f"PostgreSQL, uploads and readiness preserved ({archive_size} bytes)"
        )
    finally:
        cleanup()
        shutil.rmtree(archive_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
