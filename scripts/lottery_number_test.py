#!/usr/bin/env python3
"""End-to-end number-screen lottery lifecycle and concurrency test."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import site_media_test as admin_api  # noqa: E402


BASE = os.environ.get("BASE_URL", "http://localhost:8091").rstrip("/")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "integrity-test")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "owner")


def expect(status: int, payload: object, want: int, label: str) -> object:
    assert status == want, f"{label}: HTTP {status}, want {want}: {payload}"
    return payload


def admin_login() -> admin_api.Session:
    session = admin_api.Session()
    status, payload, _ = session.call(
        "POST",
        "/api/admin/auth/login",
        body={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
        include_csrf=False,
    )
    expect(status, payload, 200, "number lottery admin login")
    session.csrf = payload["csrf_token"]
    return session


def public_get(path: str) -> tuple[int, object]:
    request = urllib.request.Request(BASE + path, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = response.status
            payload = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        payload = exc.read()
    try:
        return status, json.loads(payload or b"{}")
    except json.JSONDecodeError:
        return status, payload.decode(errors="replace")


def set_feature(admin: admin_api.Session, enabled: bool) -> None:
    status, payload, _ = admin.call(
        "PUT",
        "/api/admin/platform/features",
        body={"features": [{"key": "lottery", "enabled": enabled, "config": {}}]},
    )
    expect(status, payload, 200, f"set lottery feature {enabled}")


def set_modes(
    admin: admin_api.Session,
    *,
    screen_enabled: bool,
    personal_enabled: bool,
) -> dict:
    status, payload, _ = admin.call(
        "PUT",
        "/api/admin/lottery/modes",
        body={
            "screen_enabled": screen_enabled,
            "personal_enabled": personal_enabled,
        },
    )
    expect(status, payload, 200, "save number lottery modes")
    return payload["modes"]


def create_event(admin: admin_api.Session, name: str, levels: list[dict]) -> dict:
    status, payload, _ = admin.call(
        "POST",
        "/api/admin/lottery/number-events",
        body={
            "name": name,
            "range_start": "1",
            "range_end": "20",
            "number_width": 3,
            "levels": levels,
        },
    )
    expect(status, payload, 200, f"create number event {name}")
    return payload


def publish(admin: admin_api.Session, event_id: int) -> dict:
    status, payload, _ = admin.call(
        "POST",
        f"/api/admin/lottery/number-events/{event_id}/publish",
    )
    expect(status, payload, 200, "publish number event")
    return payload


def draw(admin: admin_api.Session, event_id: int, level_id: int, request_id: str) -> tuple[int, object]:
    status, payload, _ = admin.call(
        "POST",
        f"/api/admin/lottery/number-events/{event_id}/draw",
        body={"level_id": level_id, "request_id": request_id},
    )
    return status, payload


def stop_live_events(admin: admin_api.Session) -> None:
    status, payload, _ = admin.call("GET", "/api/admin/lottery/number-events")
    expect(status, payload, 200, "list number events")
    for event in payload["events"]:
        if event["status"] == "live":
            status, archived, _ = admin.call(
                "POST",
                f"/api/admin/lottery/number-events/{event['id']}/archive",
            )
            expect(status, archived, 200, "archive old live number event")


def main() -> None:
    suffix = uuid.uuid4().hex[:8]
    admin = admin_login()
    set_feature(admin, True)
    set_modes(admin, screen_enabled=True, personal_enabled=False)
    stop_live_events(admin)

    status, board = public_get("/api/lottery/board")
    expect(status, board, 200, "empty public number board")
    assert board == {"enabled": True, "event": None, "levels": []}, board

    first = create_event(
        admin,
        f"号码开奖-{suffix}",
        [
            {"name": "三等奖", "winner_count": 3},
            {"name": "一等奖", "winner_count": 2},
        ],
    )
    first_event = first["event"]
    first_levels = first["levels"]
    assert first_event["status"] == "draft"
    assert all(level["state"] == "pending" for level in first_levels)

    publish(admin, first_event["id"])
    second = create_event(
        admin,
        f"并发第二场-{suffix}",
        [{"name": "一等奖", "winner_count": 1}],
    )
    status, conflict, _ = admin.call(
        "POST",
        f"/api/admin/lottery/number-events/{second['event']['id']}/publish",
    )
    assert status == 409 and conflict.get("code") == "live_event_exists", conflict

    status, board = public_get("/api/lottery/board")
    expect(status, board, 200, "live public number board")
    assert board["enabled"] is True
    assert board["event"]["id"] == first_event["id"]
    assert board["event"]["completed"] is False

    status, out_of_order = draw(
        admin,
        first_event["id"],
        first_levels[1]["id"],
        str(uuid.uuid4()),
    )
    assert status == 409 and out_of_order.get("code") == "level_out_of_order", out_of_order

    request_id = str(uuid.uuid4())
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(
            pool.map(
                lambda _: draw(
                    admin,
                    first_event["id"],
                    first_levels[0]["id"],
                    request_id,
                ),
                range(12),
            )
        )
    assert all(status == 200 for status, _ in results), results
    winners = results[0][1]["draw"]["winners"]
    assert len(winners) == 3
    assert all(payload["draw"]["winners"] == winners for _, payload in results)
    assert sum(not payload["draw"].get("duplicate", False) for _, payload in results) == 1

    status, request_conflict = draw(
        admin,
        first_event["id"],
        first_levels[1]["id"],
        request_id,
    )
    assert status == 409 and request_conflict.get("code") == "draw_request_conflict", request_conflict

    status, second_draw = draw(
        admin,
        first_event["id"],
        first_levels[1]["id"],
        str(uuid.uuid4()),
    )
    expect(status, second_draw, 200, "draw second level")
    second_winners = second_draw["draw"]["winners"]
    assert len(second_winners) == 2
    assert set(winners).isdisjoint(second_winners)

    status, detail, _ = admin.call(
        "GET",
        f"/api/admin/lottery/number-events/{first_event['id']}",
    )
    expect(status, detail, 200, "completed event detail")
    assert detail["event"]["completed"] is True
    assert all(level["state"] == "revealed" for level in detail["levels"])

    status, board = public_get("/api/lottery/board")
    expect(status, board, 200, "completed public number board")
    assert board["event"]["completed"] is True
    assert sum(len(level["winners"]) for level in board["levels"]) == 5
    assert "request_id" not in json.dumps(board)
    assert "operator" not in json.dumps(board)

    status, locked, _ = admin.call(
        "POST",
        "/api/admin/lottery/number-events",
        body={
            "id": first_event["id"],
            "name": "试图修改",
            "range_start": "1",
            "range_end": "20",
            "number_width": 3,
            "levels": [{"name": "一等奖", "winner_count": 1}],
        },
    )
    assert status == 409 and locked.get("code") == "event_not_draft", locked

    status, exported, _ = admin.call(
        "GET",
        f"/api/admin/lottery/number-events/{first_event['id']}/export",
    )
    expect(status, exported, 200, "export number winners")
    assert exported.count("\n") >= 6, exported
    assert winners[0] in exported and second_winners[0] in exported

    status, archived, _ = admin.call(
        "POST",
        f"/api/admin/lottery/number-events/{first_event['id']}/archive",
    )
    expect(status, archived, 200, "archive number event")
    status, board = public_get("/api/lottery/board")
    expect(status, board, 200, "archived public board")
    assert board["event"] is None

    set_modes(admin, screen_enabled=False, personal_enabled=False)
    status, board = public_get("/api/lottery/board")
    expect(status, board, 200, "screen mode disabled board")
    assert board == {"enabled": False, "event": None, "levels": []}
    status, campaign = public_get("/api/lottery/campaign")
    assert status == 404 and campaign.get("code") == "mode_disabled", campaign

    set_modes(admin, screen_enabled=True, personal_enabled=False)
    status, deleted, _ = admin.call(
        "DELETE",
        f"/api/admin/lottery/number-events/{second['event']['id']}",
    )
    expect(status, deleted, 200, "delete unused draft")
    set_feature(admin, False)

    print(
        "number lottery ok: modes, draft/live/archived lifecycle, one live event, "
        "ordered levels, concurrent replay, unique winners, CSV and public privacy"
    )


if __name__ == "__main__":
    main()
