#!/usr/bin/env python3
"""Start a production-cookie test container and verify secure session flags."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


IMAGE = os.environ.get("TEST_IMAGE", "szyca:release-test")
NAME = f"szyca-cookie-{uuid.uuid4().hex[:8]}"
REPORT = Path(os.environ.get("COOKIE_REPORT", "artifacts/security/secure-cookie.json"))
ADMIN_PASSWORD = f"secure-cookie-{uuid.uuid4().hex}"
POSTGRES_PASSWORD = f"secure-db-{uuid.uuid4().hex}"
TEST_HOST = os.environ.get("TEST_HOST", "127.0.0.1")


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, text=True, capture_output=True)


def cleanup() -> None:
    subprocess.run(
        ["docker", "rm", "-f", NAME],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main() -> None:
    cleanup()
    try:
        run([
            "docker", "run", "-d", "--name", NAME,
            "-p", "127.0.0.1::8080",
            "-e", "APP_PORT=8081",
            "-e", "POSTGRES_USER=szyca",
            "-e", "POSTGRES_DB=szyca",
            "-e", f"POSTGRES_PASSWORD={POSTGRES_PASSWORD}",
            "-e", f"DATABASE_URL=postgres://szyca:{POSTGRES_PASSWORD}@127.0.0.1:5432/szyca?sslmode=disable",
            "-e", "REDIS_ADDR=127.0.0.1:6379",
            "-e", "ADMIN_USERNAME=owner",
            "-e", f"ADMIN_PASSWORD={ADMIN_PASSWORD}",
            "-e", "ADMIN_COOKIE_SECURE=true",
            "-e", "UPLOAD_DIR=/data/uploads",
            IMAGE,
        ])
        port_output = run(["docker", "port", NAME, "8080/tcp"]).stdout.strip().splitlines()[0]
        port = int(port_output.rsplit(":", 1)[1])
        base = f"http://{TEST_HOST}:{port}"
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(base + "/readyz", timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(1)
        else:
            raise TimeoutError("secure cookie test container did not become ready")

        request = urllib.request.Request(
            base + "/api/admin/auth/login",
            data=json.dumps({
                "username": "owner",
                "password": ADMIN_PASSWORD,
            }).encode(),
            headers={
                "Content-Type": "application/json",
                "Origin": base,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            assert response.status == 200
            cookie = response.headers.get("Set-Cookie", "")
            body = json.loads(response.read())
        for flag in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/"):
            assert flag in cookie, f"Set-Cookie missing {flag}: {cookie}"
        assert ADMIN_PASSWORD not in cookie
        assert body["csrf_token"]

        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(
            json.dumps({
                "http_status": 200,
                "http_only": True,
                "secure": True,
                "same_site": "Strict",
                "password_in_cookie": False,
                "csrf_token_returned": True,
            }, indent=2),
            encoding="utf-8",
        )
        print("secure cookie ok: HttpOnly + Secure + SameSite=Strict, no password in cookie")
    finally:
        cleanup()


if __name__ == "__main__":
    main()
