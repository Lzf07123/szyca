#!/usr/bin/env python3
"""Build the previous admin merge and prove rollback/roll-forward on one volume."""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CURRENT_IMAGE = os.environ.get("TEST_IMAGE", "szyca:release-test")
PREVIOUS_IMAGE = "szyca:previous-admin"
PREVIOUS_COMMIT = os.environ.get("ROLLBACK_COMMIT", "8bc8c52")
PROJECT = "szyca-rollback-test"
VOLUME = f"{PROJECT}_data"
ADMIN_PASSWORD = "rollback-test-password"
CONTAINER_NAME = os.environ.get("TEST_CONTAINER_NAME", "szyca")
COMPOSE_OVERRIDE = os.environ.get("TEST_COMPOSE_OVERRIDE", "")


def run(args: list[str], cwd: Path = ROOT, **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=True, **kwargs)


def compose_args() -> list[str]:
    args = ["docker", "compose", "-p", PROJECT, "-f", "deploy/docker-compose.yml"]
    if COMPOSE_OVERRIDE:
        args.extend(["-f", COMPOSE_OVERRIDE])
    return args


def compose(action: str, image: str, port: int) -> None:
    env = os.environ.copy()
    env.update({
        "SZYCA_IMAGE": image,
        "SZYCA_PULL_POLICY": "never",
        "WEB_PORT": str(port),
        "ADMIN_PASSWORD": ADMIN_PASSWORD,
        "POSTGRES_PASSWORD": "szyca",
        "LEGACY_ADMIN_TOKEN_ENABLED": "false",
    })
    args = [*compose_args(), action]
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
    raise TimeoutError(f"rollback stack on {port} did not become ready")


def psql(query: str) -> str:
    return run([
        "docker", "exec", CONTAINER_NAME,
        "env", "PGPASSWORD=szyca", "psql", "-h", "127.0.0.1",
        "-U", "szyca", "-d", "szyca", "-Atc", query,
    ]).stdout.strip()


def cleanup() -> None:
    env = os.environ.copy()
    env.update({"SZYCA_IMAGE": CURRENT_IMAGE, "SZYCA_PULL_POLICY": "never"})
    subprocess.run(
        [*compose_args(), "down"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["docker", "volume", "rm", VOLUME],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def build_previous_image() -> None:
    raw_bytes = subprocess.run(
        ["git", "archive", "--format=tar", PREVIOUS_COMMIT],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout
    temp_dir = Path(tempfile.mkdtemp(prefix="szyca-previous-"))
    try:
        with tarfile.open(fileobj=io.BytesIO(raw_bytes), mode="r:") as archive:
            archive.extractall(temp_dir)
        run([
            "docker", "build",
            "-f", str(temp_dir / "deploy/Dockerfile"),
            "-t", PREVIOUS_IMAGE,
            str(temp_dir),
        ])
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> None:
    existing = run([
        "docker", "ps", "-a", "--filter", f"name=^/{CONTAINER_NAME}$",
        "--format", "{{.Names}}",
    ]).stdout.strip()
    if existing:
        raise RuntimeError(
            f"container named {CONTAINER_NAME} exists; stop it before the rollback drill"
        )
    cleanup()
    try:
        build_previous_image()
        compose("up", CURRENT_IMAGE, 8098)
        wait_ready(8098)
        psql("""
            INSERT INTO app_meta (k, v) VALUES ('rollback_marker', 'new-version-data')
            ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
            INSERT INTO lottery_campaigns (name, status, enabled)
            VALUES ('回滚演练活动', 'ended', FALSE)
        """)
        assert int(psql("SELECT count(*) FROM lottery_campaigns")) >= 1
        compose("down", CURRENT_IMAGE, 8098)

        compose("up", PREVIOUS_IMAGE, 8098)
        wait_ready(8098)
        marker = psql("SELECT v FROM app_meta WHERE k = 'rollback_marker'")
        assert marker == "new-version-data", marker
        tables = int(psql("SELECT count(*) FROM lottery_campaigns"))
        assert tables >= 1, "new tables were lost during rollback"
        site = run([
            "docker", "exec", CONTAINER_NAME,
            "wget", "-qO-", "http://127.0.0.1:8080/api/site",
        ]).stdout
        assert '"sections"' in site
        previous_lottery = subprocess.run(
            [
                "docker", "exec", CONTAINER_NAME, "wget", "-qO-",
                "http://127.0.0.1:8080/api/lottery/campaign",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        assert previous_lottery.returncode != 0, "previous version unexpectedly exposed lottery"
        compose("down", PREVIOUS_IMAGE, 8098)

        compose("up", CURRENT_IMAGE, 8098)
        wait_ready(8098)
        marker = psql("SELECT v FROM app_meta WHERE k = 'rollback_marker'")
        tables = int(psql("SELECT count(*) FROM lottery_campaigns"))
        assert marker == "new-version-data" and tables >= 1
        print(
            "rollback ok: current -> previous admin merge -> current, "
            "preserving data and new tables without old-code startup failure"
        )
    finally:
        cleanup()


if __name__ == "__main__":
    main()
