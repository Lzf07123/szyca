#!/usr/bin/env python3
"""Exercise full /data volume backup and restore through two isolated stacks."""

from __future__ import annotations

import os
import subprocess
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMAGE = os.environ.get("TEST_IMAGE", "szyca:release-test")
SOURCE_PROJECT = "szyca-backup-src"
TARGET_PROJECT = "szyca-backup-dst"
SOURCE_VOLUME = f"{SOURCE_PROJECT}_data"
TARGET_VOLUME = f"{TARGET_PROJECT}_data"
ARCHIVE_VOLUME = "szyca-backup-archive"
ADMIN_PASSWORD = "backup-test-password"
CONTAINER_NAME = os.environ.get("TEST_CONTAINER_NAME", "szyca")
COMPOSE_OVERRIDE = os.environ.get("TEST_COMPOSE_OVERRIDE", "")


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True, **kwargs)


def compose_args(project: str) -> list[str]:
    args = ["docker", "compose", "-p", project, "-f", "deploy/docker-compose.yml"]
    if COMPOSE_OVERRIDE:
        args.extend(["-f", COMPOSE_OVERRIDE])
    return args


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
    args = [*compose_args(project), action]
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
        *compose_args(SOURCE_PROJECT), "exec", "-T", "szyca",
        "env", "PGPASSWORD=szyca", "psql", "-h", "127.0.0.1",
        "-U", "szyca", "-d", "szyca", "-Atc", query,
    ]).stdout.strip()


def cleanup() -> None:
    for project in (SOURCE_PROJECT, TARGET_PROJECT):
        env = os.environ.copy()
        env.update({"SZYCA_IMAGE": IMAGE, "SZYCA_PULL_POLICY": "never"})
        subprocess.run(
            [
                *compose_args(project), "down",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    for volume in (SOURCE_VOLUME, TARGET_VOLUME, ARCHIVE_VOLUME):
        subprocess.run(
            ["docker", "volume", "rm", volume],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    existing = run([
        "docker", "ps", "-a", "--filter", f"name=^/{CONTAINER_NAME}$",
        "--format", "{{.Names}}",
    ]).stdout.strip()
    if existing:
        raise RuntimeError(
            f"container named {CONTAINER_NAME} exists; stop it before the restore drill"
        )
    cleanup()
    try:
        compose(SOURCE_PROJECT, 8096, "up")
        wait_ready(8096)
        psql("""
            INSERT INTO app_meta (k, v) VALUES ('backup_restore_marker', 'preserved')
            ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
        """)
        run([
            "docker", "exec", CONTAINER_NAME, "sh", "-c",
            "printf 'upload-preserved\\n' > /data/uploads/backup-marker.txt",
        ])

        # Stop the application but keep its named data volume for the snapshot.
        compose(SOURCE_PROJECT, 8096, "down")
        run(["docker", "volume", "create", ARCHIVE_VOLUME])
        run([
            "docker", "run", "--rm",
            "-v", f"{SOURCE_VOLUME}:/data:ro",
            "-v", f"{ARCHIVE_VOLUME}:/backup",
            "alpine:3.24",
            "tar", "-czf", "/backup/data.tgz", "-C", "/data", ".",
        ])
        archive_size = int(run([
            "docker", "run", "--rm",
            "-v", f"{ARCHIVE_VOLUME}:/backup:ro",
            "alpine:3.24",
            "stat", "-c", "%s", "/backup/data.tgz",
        ]).stdout.strip())
        assert archive_size > 0

        run(["docker", "volume", "create", TARGET_VOLUME])
        run([
            "docker", "run", "--rm",
            "-v", f"{TARGET_VOLUME}:/data",
            "-v", f"{ARCHIVE_VOLUME}:/backup:ro",
            "alpine:3.24",
            "tar", "-xzf", "/backup/data.tgz", "-C", "/data",
        ])
        compose(TARGET_PROJECT, 8097, "up")
        wait_ready(8097)

        marker = run([
            "docker", "exec", CONTAINER_NAME,
            "env", "PGPASSWORD=szyca", "psql", "-h", "127.0.0.1",
            "-U", "szyca", "-d", "szyca", "-Atc",
            "SELECT v FROM app_meta WHERE k = 'backup_restore_marker'",
        ]).stdout.strip()
        assert marker == "preserved", marker
        upload = run([
            "docker", "exec", CONTAINER_NAME, "cat", "/data/uploads/backup-marker.txt",
        ]).stdout.strip()
        assert upload == "upload-preserved", upload
        health = run([
            "docker", "exec", CONTAINER_NAME,
            "wget", "-qO-", "http://127.0.0.1:8080/readyz",
        ]).stdout.strip()
        assert '"status":"ready"' in health, health

        print(
            "backup restore ok: full /data archive restored to a new stack; "
            f"PostgreSQL, uploads and readiness preserved ({archive_size} bytes)"
        )
    finally:
        cleanup()


if __name__ == "__main__":
    main()
