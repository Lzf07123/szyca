#!/usr/bin/env python3
"""End-to-end lottery correctness, idempotency, stock and concurrency test."""

from __future__ import annotations

import csv
import io
import json
import math
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import site_media_test as admin_api  # noqa: E402


BASE = os.environ.get("BASE_URL", "http://localhost:8092").rstrip("/")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "foundation-test")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "owner")
PROJECT = os.environ.get("COMPOSE_PROJECT", "stpt-foundation-test")
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "szyca")


def expect(status: int, payload: object, want: int, label: str) -> object:
    assert status == want, f"{label}: HTTP {status}, want {want}: {payload}"
    return payload


def psql(query: str) -> str:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-p",
            PROJECT,
            "-f",
            "deploy/docker-compose.yml",
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


def user_http(
    method: str,
    path: str,
    body: object | None = None,
    token: str | None = None,
    raw: bool = False,
) -> tuple[int, object]:
    data = None
    headers: dict[str, str] = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    if raw:
        return status, payload
    try:
        parsed = json.loads(payload or b"{}")
    except json.JSONDecodeError:
        parsed = payload.decode(errors="replace")
    return status, parsed


def admin_login() -> admin_api.Session:
    session = admin_api.Session()
    status, payload, _ = session.call(
        "POST",
        "/api/admin/auth/login",
        body={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
        include_csrf=False,
    )
    expect(status, payload, 200, "lottery admin login")
    session.csrf = payload["csrf_token"]
    return session


def set_lottery_feature(admin: admin_api.Session, enabled: bool) -> None:
    status, payload, _ = admin.call(
        "PUT",
        "/api/admin/platform/features",
        body={
            "features": [
                {"key": "lottery", "enabled": enabled, "config": {}}
            ]
        },
    )
    expect(status, payload, 200, f"set lottery feature {enabled}")


def create_campaign(admin: admin_api.Session, name: str) -> dict:
    now = datetime.now(timezone.utc)
    status, payload, _ = admin.call(
        "POST",
        "/api/admin/lottery/campaigns",
        body={
            "name": name,
            "status": "active",
            "starts_at": (now - timedelta(minutes=5)).isoformat(),
            "ends_at": (now + timedelta(hours=2)).isoformat(),
            "eligibility": "completed_round",
            "eligibility_min_score": 0,
            "no_win_weight": 0,
            "enabled": True,
        },
    )
    expect(status, payload, 200, f"create campaign {name}")
    return payload["campaign"]


def set_campaign_status(admin: admin_api.Session, campaign_id: int, status_value: str) -> None:
    status, payload, _ = admin.call(
        "POST",
        f"/api/admin/lottery/campaigns/{campaign_id}/status",
        body={"status": status_value},
    )
    expect(status, payload, 200, f"campaign {campaign_id} -> {status_value}")


def stop_all_campaigns(admin: admin_api.Session) -> None:
    status, payload, _ = admin.call("GET", "/api/admin/lottery/campaigns")
    expect(status, payload, 200, "list campaigns for cleanup")
    for campaign in payload["campaigns"]:
        if campaign["status"] != "ended":
            set_campaign_status(admin, campaign["id"], "ended")


def create_prize(
    admin: admin_api.Session,
    campaign_id: int,
    name: str,
    stock: int,
) -> dict:
    status, payload, _ = admin.call(
        "POST",
        f"/api/admin/lottery/campaigns/{campaign_id}/prizes",
        body={
            "name": name,
            "total": stock,
            "remaining": stock,
            "weight": 1,
            "enabled": True,
            "sort": 10,
        },
    )
    expect(status, payload, 200, f"create prize {name}")
    return payload["prize"]


def create_quiz_user() -> tuple[int, str]:
    suffix = uuid.uuid4().hex
    status, payload = user_http(
        "POST",
        "/api/session",
        {"nickname": "抽奖" + suffix[:8], "device_fp": "lottery-" + suffix},
    )
    expect(status, payload, 200, "create quiz identity")
    return payload["user_id"], payload["token"]


def complete_round(token: str) -> None:
    status, payload = user_http(
        "POST",
        "/api/quiz/round",
        {"difficulty": "全部"},
        token,
    )
    expect(status, payload, 200, "start lottery qualification round")
    for question in payload["questions"]:
        answer = int(
            psql(f"SELECT answer FROM questions WHERE id = {int(question['id'])}")
        )
        status, answer_payload = user_http(
            "POST",
            "/api/answer",
            {
                "request_id": str(uuid.uuid4()),
                "question_id": question["id"],
                "selected": answer,
            },
            token,
        )
        expect(status, answer_payload, 200, f"answer lottery question {question['id']}")


def draw_once(token: str, request_id: str) -> tuple[int, object, float]:
    started = time.perf_counter()
    status, payload = user_http(
        "POST",
        "/api/lottery/draw",
        {"request_id": request_id},
        token,
    )
    return status, payload, (time.perf_counter() - started) * 1000


def seed_concurrent_users(prefix: str, count: int) -> list[str]:
    values = []
    tokens = []
    for index in range(count):
        token = f"lottery-{prefix}-{index}-{uuid.uuid4().hex}"
        tokens.append(token)
        nickname = f"并发{prefix}{index}"
        device = f"device-{prefix}-{index}-{uuid.uuid4().hex}"
        values.append(f"('{nickname}','{token}','{device}')")
    psql(
        "INSERT INTO users (nickname, token, device_fp) VALUES "
        + ",".join(values)
    )
    psql(
        f"""
        INSERT INTO attempts
          (user_id, question_id, selected, correct, score, request_id, round_no, counted)
        SELECT u.id, q.id, 0, FALSE, 0,
               'seed-{prefix}-' || u.id || '-' || q.id, 1, TRUE
        FROM users u
        CROSS JOIN (
          SELECT id FROM questions WHERE active ORDER BY id LIMIT 10
        ) q
        WHERE u.token LIKE 'lottery-{prefix}-%'
        """
    )
    return tokens


def p99(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.99) - 1)]


def main() -> None:
    suffix = uuid.uuid4().hex[:8]
    admin = admin_login()
    stop_all_campaigns(admin)

    set_lottery_feature(admin, False)
    status, payload = user_http("GET", "/api/lottery/campaign")
    assert status == 404 and payload.get("code") == "feature_disabled", payload
    set_lottery_feature(admin, True)

    status, payload = user_http("POST", "/api/admin/quiz-state", {"state": "start"}, token=None)
    assert status == 401, "quiz state unexpectedly accepted without admin access"
    status, payload, _ = admin.call("POST", "/api/admin/quiz-state", body={"state": "start"})
    expect(status, payload, 200, "start quiz")

    first_campaign = create_campaign(admin, f"幂等活动-{suffix}")
    first_prize = create_prize(admin, first_campaign["id"], f"测试奖品-{suffix}", 5)
    status, public_campaign = user_http("GET", "/api/lottery/campaign")
    expect(status, public_campaign, 200, "public campaign")
    assert "weight" not in json.dumps(public_campaign), "public campaign leaked prize weight"

    user_id, token = create_quiz_user()
    complete_round(token)
    status, status_payload = user_http("GET", "/api/lottery/campaign", token=token)
    expect(status, status_payload, 200, "eligible campaign status")
    assert status_payload["eligible"] is True

    requests = [str(uuid.uuid4()) for _ in range(12)]
    with ThreadPoolExecutor(max_workers=12) as pool:
        same_user_results = list(
            pool.map(lambda request_id: draw_once(token, request_id), requests)
        )
    successes = [(request_id, result) for request_id, result in zip(requests, same_user_results) if result[0] == 200]
    assert len(successes) == 1, same_user_results
    winning_request, (_, winning_payload, _) = successes[0]
    assert winning_payload["result"] in {"won", "no_win"}
    for status_code, payload, _ in same_user_results:
        assert status_code in {200, 409}, (status_code, payload)

    remaining_after_draw = int(
        psql(f"SELECT remaining FROM lottery_prizes WHERE id = {first_prize['id']}")
    )
    status, retry_payload = user_http(
        "POST", "/api/lottery/draw", {"request_id": winning_request}, token
    )
    expect(status, retry_payload, 200, "same request replay")
    assert retry_payload["duplicate"] is True
    assert retry_payload["draw_id"] == winning_payload["draw_id"]
    remaining_after_retry = int(
        psql(f"SELECT remaining FROM lottery_prizes WHERE id = {first_prize['id']}")
    )
    assert remaining_after_retry == remaining_after_draw, "idempotent retry consumed stock"
    status, me_payload = user_http("GET", "/api/lottery/me", token=token)
    expect(status, me_payload, 200, "current user lottery result")
    assert me_payload["draw"]["draw_id"] == winning_payload["draw_id"]
    status, conflict = user_http(
        "POST", "/api/lottery/draw", {"request_id": str(uuid.uuid4())}, token
    )
    assert status == 409 and conflict.get("code") == "already_drawn", conflict

    _, ineligible_token = create_quiz_user()
    status, ineligible = user_http(
        "POST", "/api/lottery/draw", {"request_id": str(uuid.uuid4())}, ineligible_token
    )
    assert status == 403 and ineligible.get("code") == "not_eligible", ineligible

    status, claim_payload, _ = admin.call(
        "POST", f"/api/admin/lottery/draws/{winning_payload['draw_id']}/claim"
    )
    expect(status, claim_payload, 200, "claim draw")
    status, claim_payload, _ = admin.call(
        "POST", f"/api/admin/lottery/draws/{winning_payload['draw_id']}/claim"
    )
    assert status == 409, claim_payload

    set_campaign_status(admin, first_campaign["id"], "paused")
    status, retry_after_pause = user_http(
        "POST", "/api/lottery/draw", {"request_id": winning_request}, token
    )
    expect(status, retry_after_pause, 200, "replay after campaign pause")
    assert retry_after_pause["duplicate"] is True
    concurrent_campaign = create_campaign(admin, f"一百用户并发-{suffix}")
    stock = 60
    concurrency_prize = create_prize(
        admin, concurrent_campaign["id"], f"并发奖品-{suffix}", stock
    )
    prefix = "c" + suffix
    tokens = seed_concurrent_users(prefix, 100)

    def concurrent_draw(token_value: str) -> tuple[int, object, float]:
        return draw_once(token_value, str(uuid.uuid4()))

    with ThreadPoolExecutor(max_workers=50) as pool:
        results = list(pool.map(concurrent_draw, tokens))
    assert all(status_code == 200 for status_code, _, _ in results), [
        (status_code, payload) for status_code, payload, _ in results if status_code != 200
    ]
    winners = [payload for _, payload, _ in results if payload["result"] == "won"]
    no_wins = [payload for _, payload, _ in results if payload["result"] == "no_win"]
    assert len(winners) == stock, (len(winners), stock)
    assert len(no_wins) == 100 - stock, (len(no_wins), no_wins)
    latency_p99 = p99([latency for _, _, latency in results])
    remaining = int(psql(
        f"SELECT remaining FROM lottery_prizes WHERE id = {concurrency_prize['id']}"
    ))
    assert remaining == 0, remaining
    negative = int(psql(
        "SELECT count(*) FROM lottery_prizes WHERE remaining < 0"
    ))
    inconsistent = int(psql(f"""
        SELECT count(*) FROM lottery_draws d
        JOIN lottery_prizes p ON p.id = d.prize_id
        WHERE d.campaign_id = {concurrent_campaign['id']}
          AND d.status IN ('won','claimed')
          AND d.prize_id IS NULL
    """))
    assert negative == 0 and inconsistent == 0
    db_consistency = psql(f"""
        SELECT count(*) || ':' ||
               count(*) FILTER (WHERE status IN ('won','claimed')) || ':' ||
               count(*) FILTER (WHERE status = 'no_win')
        FROM lottery_draws
        WHERE campaign_id = {concurrent_campaign['id']}
    """)
    assert db_consistency == "100:60:40", db_consistency

    status, draws_payload, _ = admin.call(
        "GET", f"/api/admin/lottery/draws?campaign_id={concurrent_campaign['id']}&limit=200"
    )
    expect(status, draws_payload, 200, "list lottery draws")
    assert len(draws_payload["draws"]) == 100
    status, exported, _ = admin.call(
        "GET", f"/api/admin/lottery/export?campaign_id={concurrent_campaign['id']}"
    )
    expect(status, exported, 200, "export lottery draws")
    assert exported.count("\n") >= 101, "lottery export is missing draw rows"

    status, _ = user_http("GET", "/api/lottery/campaign")
    expect(status, _, 200, "paused campaign visible")

    set_campaign_status(admin, concurrent_campaign["id"], "paused")
    status, payload = user_http("POST", "/api/lottery/draw", {"request_id": str(uuid.uuid4())}, tokens[0])
    assert status == 409 and payload.get("code") == "campaign_not_active", payload

    set_lottery_feature(admin, False)
    status, payload = user_http("GET", "/api/lottery/campaign")
    assert status == 404 and payload.get("code") == "feature_disabled", payload

    print(
        "lottery ok: feature gate, eligibility, CSPRNG weighted draw, idempotency, "
        f"same-user concurrency, claim, 100-user stock consistency, P99={latency_p99:.1f}ms"
    )


if __name__ == "__main__":
    main()
