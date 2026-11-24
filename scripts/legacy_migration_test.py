#!/usr/bin/env python3
"""Upgrade a seeded pre-migration database and verify preservation/idempotence."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMAGE = os.environ.get("TEST_IMAGE", "szyca:release-test")
NETWORK = "szyca-legacy-test-net"
PG = "szyca-legacy-pg"
REDIS = "szyca-legacy-redis"
APP = "szyca-legacy-app"
BASELINE = ROOT / "backend/core/platform/migrate/migrations/0001_quiz_baseline.sql"


def run(args: list[str], **kwargs) -> str:
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def cleanup() -> None:
    for name in (APP, PG, REDIS):
        subprocess.run(
            ["docker", "rm", "-f", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    subprocess.run(
        ["docker", "network", "rm", NETWORK],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def psql(query: str, *, database: str = "szyca", check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            PG,
            "env",
            "PGPASSWORD=szyca",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            "127.0.0.1",
            "-U",
            "szyca",
            "-d",
            database,
            "-Atc",
            query,
        ],
        check=check,
        text=True,
        capture_output=True,
    )


def wait_postgres() -> None:
    deadline = time.time() + 45
    while time.time() < deadline:
        result = subprocess.run(
            ["docker", "exec", PG, "pg_isready", "-U", "szyca", "-d", "szyca"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            return
        time.sleep(1)
    raise TimeoutError("legacy PostgreSQL did not become ready")


def launch_app() -> None:
    run([
        "docker", "run", "-d", "--name", APP, "--network", NETWORK,
        "--entrypoint", "/app/server",
        "-e", "APP_PORT=8095",
        "-e", f"DATABASE_URL=postgres://szyca:szyca@{PG}:5432/szyca?sslmode=disable",
        "-e", f"REDIS_ADDR={REDIS}:6379",
        "-e", "ADMIN_PASSWORD=legacy-test-password",
        "-e", "UPLOAD_DIR=/tmp/uploads",
        IMAGE,
    ])


def wait_app() -> None:
    deadline = time.time() + 45
    while time.time() < deadline:
        result = subprocess.run(
            ["docker", "exec", APP, "wget", "-qO-", "http://127.0.0.1:8095/readyz"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            return
        time.sleep(1)
    logs = subprocess.run(
        ["docker", "logs", "--tail", "80", APP],
        text=True,
        capture_output=True,
    )
    raise RuntimeError(f"legacy upgrade app did not become ready:\n{logs.stdout}\n{logs.stderr}")


def snapshot() -> dict[str, int]:
    raw = psql("""
        SELECT json_build_object(
          'users', (SELECT count(*) FROM users),
          'questions', (SELECT count(*) FROM questions),
          'attempts', (SELECT count(*) FROM attempts),
          'round_questions', (SELECT count(*) FROM round_questions),
          'qrcodes', (SELECT count(*) FROM qrcodes),
          'backgrounds', (SELECT count(*) FROM backgrounds),
          'section_count', (SELECT count(*) FROM home_sections),
          'gallery_images', (SELECT count(*) FROM gallery_images),
          'admin_count', (SELECT count(*) FROM admin_accounts)
        )
    """).stdout.strip()
    return json.loads(raw)


def main() -> None:
    cleanup()
    try:
        run(["docker", "network", "create", NETWORK])
        run([
            "docker", "run", "-d", "--name", PG, "--network", NETWORK,
            "-e", "POSTGRES_USER=szyca",
            "-e", "POSTGRES_PASSWORD=szyca",
            "-e", "POSTGRES_DB=szyca",
            "postgres:16-alpine",
        ])
        run([
            "docker", "run", "-d", "--name", REDIS, "--network", NETWORK,
            "redis:7-alpine",
        ])
        wait_postgres()

        baseline_sql = BASELINE.read_text(encoding="utf-8")
        run([
            "docker", "exec", "-i", PG, "env", "PGPASSWORD=szyca",
            "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
            "-U", "szyca", "-d", "szyca",
        ], input=baseline_sql)
        psql("""
            INSERT INTO users (nickname, token, device_fp)
            VALUES
              ('旧用户甲', 'legacy-token-a', 'legacy-device-a'),
              ('旧用户乙', 'legacy-token-b', 'legacy-device-b');
            INSERT INTO questions (content, options, answer, score, sort, active, difficulty)
            SELECT '旧题 ' || i, '["A","B","C","D"]'::jsonb, 0, 10, i, TRUE, '简单'
            FROM generate_series(1, 12) i;
            INSERT INTO attempts
              (user_id, question_id, selected, correct, score, request_id, round_no, counted)
            SELECT u.id, q.id, 0, TRUE, 10,
                   'legacy-' || u.id || '-' || q.id, 1, TRUE
            FROM users u CROSS JOIN questions q
            WHERE q.sort <= 10;
            INSERT INTO round_questions (user_id, round_no, position, question_id)
            SELECT u.id, 1, q.sort, q.id
            FROM users u CROSS JOIN questions q
            WHERE q.sort <= 10;
            INSERT INTO qrcodes (image_url, title, active)
            VALUES ('/uploads/legacy-qr.png', '旧二维码', TRUE);
            INSERT INTO backgrounds (file_path, active)
            VALUES ('/uploads/legacy-bg.jpg', TRUE);
            INSERT INTO footer_settings (id, owner, license, icp)
            VALUES (1, '旧协会', 'MIT', '旧备案号')
            ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner;
            INSERT INTO site_settings (id, logo_url)
            VALUES (1, '/uploads/legacy-logo.png')
            ON CONFLICT (id) DO UPDATE SET logo_url = EXCLUDED.logo_url;
            INSERT INTO app_meta (k, v) VALUES ('skip_seed', '1')
            ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
        """)
        before = json.loads(psql("""
            SELECT json_build_object(
              'users', (SELECT count(*) FROM users),
              'questions', (SELECT count(*) FROM questions),
              'attempts', (SELECT count(*) FROM attempts),
              'round_questions', (SELECT count(*) FROM round_questions),
              'qrcodes', (SELECT count(*) FROM qrcodes),
              'backgrounds', (SELECT count(*) FROM backgrounds)
            )
        """).stdout)

        # A failed transaction must not leave a partially created object.
        failed = psql(
            "BEGIN; CREATE TABLE rollback_guard (id int); SELECT 1/0; COMMIT;",
            check=False,
        )
        assert failed.returncode != 0, "rollback probe unexpectedly succeeded"
        assert psql("SELECT to_regclass('public.rollback_guard') IS NULL").stdout.strip() == "t"

        lock_holder = subprocess.Popen(
            [
                "docker", "exec", PG,
                "env", "PGPASSWORD=szyca", "psql",
                "-h", "127.0.0.1", "-U", "szyca", "-d", "szyca",
                "-Atc",
                f"SELECT pg_advisory_lock({int('535A5943414D4947', 16)}); "
                "SELECT pg_sleep(3)",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        time.sleep(0.5)
        launch_app()
        time.sleep(1)
        blocked = subprocess.run(
            ["docker", "exec", APP, "wget", "-qO-", "http://127.0.0.1:8095/readyz"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        assert blocked.returncode != 0, "app replied before migration advisory lock was released"
        stdout, stderr = lock_holder.communicate(timeout=10)
        assert lock_holder.returncode == 0, (stdout, stderr)
        wait_app()
        first = snapshot()
        assert first["users"] == before["users"] == 2, (before, first)
        assert first["questions"] == before["questions"] == 12, (before, first)
        assert first["attempts"] == before["attempts"] == 20, (before, first)
        assert first["round_questions"] == before["round_questions"] == 20, (before, first)
        assert first["qrcodes"] == before["qrcodes"] == 1, (before, first)
        assert first["backgrounds"] == before["backgrounds"] == 1, (before, first)
        assert first["section_count"] == 9
        assert first["gallery_images"] == 0
        assert first["admin_count"] >= 1
        versions = psql("SELECT version FROM schema_migrations ORDER BY version").stdout.splitlines()
        assert versions == [
            "0001_quiz_baseline.sql",
            "0002_site_access_media.sql",
            "0003_lottery.sql",
            "0004_section_plugins.sql",
            "0005_gallery.sql",
            "202611240001_screen_section.sql",
            "202611240002_lottery_number_board.sql",
            "202611240003_lottery_public_copy.sql",
            "202611240004_lottery_mode_entries.sql",
            "202611240005_lottery_screen_default_copy.sql",
            "202611240006_lottery_screen_enabled.sql",
        ], versions
        assert psql(
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_name = 'home_sections' AND column_name = 'plugin_version'"
        ).stdout.strip() == "1"
        assert psql(
            "SELECT count(*) FROM pg_constraint "
            "WHERE conname = 'home_sections_kind_check'"
        ).stdout.strip() == "0"
        assert psql(
            "SELECT to_regclass('public.gallery_images') IS NOT NULL"
        ).stdout.strip() == "t"
        assert psql(
            "SELECT plugin_version FROM home_sections WHERE kind = 'gallery' LIMIT 1"
        ).stdout.strip() == "2"
        assert psql(
            "SELECT to_regclass('public.lottery_number_events') IS NOT NULL"
        ).stdout.strip() == "t"
        assert psql(
            "SELECT screen_enabled || ':' || personal_enabled "
            "FROM lottery_mode_settings WHERE id = 1"
        ).stdout.strip() == "true:false"
        assert psql(
            "SELECT config->>'body' FROM home_sections WHERE kind = 'lottery' LIMIT 1"
        ).stdout.strip() == "现场号码抽奖实时开奖，中奖结果在大屏统一公布。"

        config = run(["docker", "exec", APP, "wget", "-qO-", "http://127.0.0.1:8095/api/config"])
        site = run(["docker", "exec", APP, "wget", "-qO-", "http://127.0.0.1:8095/api/site"])
        assert '"quiz_state"' in config and '"sections"' in site

        subprocess.run(
            ["docker", "rm", "-f", APP],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        launch_app()
        wait_app()
        second = snapshot()
        assert second == first, (first, second)
        versions_after = psql("SELECT version FROM schema_migrations ORDER BY version").stdout.splitlines()
        assert versions_after == versions

        print(
            "legacy migration ok: pre-seeded data preserved, 11 migrations recorded once, "
            "failed transaction rolled back, restart idempotent"
        )
    finally:
        cleanup()


if __name__ == "__main__":
    main()
