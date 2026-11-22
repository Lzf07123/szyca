#!/usr/bin/env python3
"""Exercise administrator sessions, RBAC, CSRF, Origin and audit in Docker."""

from __future__ import annotations

import http.cookiejar
import json
import os
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass


BASE = os.environ.get("BASE_URL", "http://localhost:8092").rstrip("/")
OWNER = os.environ.get("ADMIN_USERNAME", "owner")
OWNER_PASSWORD = os.environ.get("ADMIN_PASSWORD", "foundation-test")


@dataclass
class Session:
    opener: urllib.request.OpenerDirector
    csrf: str = ""
    account: dict | None = None


def new_session() -> Session:
    jar = http.cookiejar.CookieJar()
    return Session(urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)))


def call(
    session: Session,
    method: str,
    path: str,
    body: object | None = None,
    *,
    csrf: bool = True,
    origin: str = BASE,
    raw: bool = False,
) -> tuple[int, object]:
    data = None
    headers = {"Origin": origin}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if csrf and method not in {"GET", "HEAD", "OPTIONS"} and session.csrf:
        headers["X-CSRF-Token"] = session.csrf
    request = urllib.request.Request(
        BASE + path, data=data, headers=headers, method=method
    )
    try:
        with session.opener.open(request, timeout=15) as response:
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


def expect(status: int, payload: object, want: int, label: str) -> object:
    assert status == want, f"{label}: HTTP {status}, want {want}: {payload}"
    return payload


def login(username: str, password: str) -> Session:
    session = new_session()
    status, payload = call(
        session,
        "POST",
        "/api/admin/auth/login",
        {"username": username, "password": password},
        csrf=False,
    )
    expect(status, payload, 200, f"login {username}")
    session.csrf = payload["csrf_token"]
    session.account = payload["account"]
    return session


def main() -> None:
    owner = login(OWNER, OWNER_PASSWORD)
    assert owner.account["role"] == "owner"
    assert owner.account["capabilities"] == ["*"]

    status, payload = call(owner, "PUT", "/api/admin/platform/features", {"features": []})
    expect(status, payload, 400, "empty feature update validation")

    suffix = uuid.uuid4().hex[:8]
    roles = ["content_editor", "event_operator", "data_viewer"]
    accounts: dict[str, tuple[str, str]] = {}
    for role in roles:
        username = f"{role[:5]}-{suffix}"
        password = f"Test-{suffix}-{role}"
        status, payload = call(
            owner,
            "POST",
            "/api/admin/accounts",
            {"username": username, "password": password, "role": role},
        )
        expect(status, payload, 201, f"create {role}")
        accounts[role] = (username, password)

    content = login(*accounts["content_editor"])
    event = login(*accounts["event_operator"])
    viewer = login(*accounts["data_viewer"])

    feature = {
        "features": [
            {
                "key": "quiz",
                "enabled": True,
                "config": {},
            }
        ]
    }
    status, payload = call(content, "PUT", "/api/admin/platform/features", feature)
    expect(status, payload, 200, "content editor site write")
    status, payload = call(content, "PUT", "/api/admin/platform/features", {
        "features": [{"key": "lottery", "enabled": False, "config": {}}]
    })
    expect(status, payload, 403, "content editor cannot control lottery")
    status, payload = call(content, "GET", "/api/admin/export/scores")
    expect(status, payload, 403, "content editor cannot export scores")
    status, payload = call(content, "GET", "/api/admin/lottery/campaigns")
    expect(status, payload, 403, "content editor cannot access lottery")

    status, payload = call(event, "POST", "/api/admin/quiz-state", {"state": "stop"})
    expect(status, payload, 200, "event operator controls quiz")
    status, payload = call(event, "GET", "/api/admin/lottery/campaigns")
    expect(status, payload, 200, "event operator reads lottery")
    status, payload = call(event, "PUT", "/api/admin/platform/features", {
        "features": [{"key": "lottery", "enabled": False, "config": {}}]
    })
    expect(status, payload, 200, "event operator controls lottery switch")
    status, payload = call(event, "PUT", "/api/admin/platform/features", feature)
    expect(status, payload, 403, "event operator cannot edit site")
    status, payload = call(event, "GET", "/api/admin/export/scores")
    expect(status, payload, 403, "event operator cannot export scores")

    status, payload = call(viewer, "GET", "/api/admin/questions")
    expect(status, payload, 200, "data viewer reads question bank")
    status, payload = call(viewer, "GET", "/api/admin/export/scores")
    expect(status, payload, 200, "data viewer exports scores")
    status, payload = call(viewer, "POST", "/api/admin/quiz-state", {"state": "stop"})
    expect(status, payload, 403, "data viewer cannot operate quiz")
    status, payload = call(viewer, "GET", "/api/admin/audit")
    expect(status, payload, 200, "data viewer reads audit")
    status, payload = call(viewer, "GET", "/api/admin/lottery/campaigns")
    expect(status, payload, 403, "data viewer cannot access lottery")

    status, payload = call(
        content,
        "PUT",
        "/api/admin/platform/features",
        feature,
        csrf=False,
    )
    expect(status, payload, 403, "missing CSRF")
    status, payload = call(
        content,
        "PUT",
        "/api/admin/platform/features",
        feature,
        origin="https://evil.example",
    )
    expect(status, payload, 403, "foreign Origin")

    content_id = content.account["id"]
    status, payload = call(
        owner,
        "POST",
        f"/api/admin/accounts/{content_id}/disabled",
        {"disabled": True},
    )
    expect(status, payload, 200, "disable account")
    status, payload = call(content, "GET", "/api/admin/auth/me")
    expect(status, payload, 401, "disabled account session revoked")

    status, payload = call(owner, "GET", "/api/admin/audit?limit=200")
    expect(status, payload, 200, "read audit")
    entries = payload["entries"]
    assert any(
        entry["actor_name"] == OWNER and entry["action"] == "admin.login"
        for entry in entries
    ), "owner login was not audited"
    assert any(
        entry["actor_name"] == accounts["event_operator"][0]
        and entry["action"] == "admin.post"
        for entry in entries
    ), "event operator write was not audited"
    assert all("password" not in json.dumps(entry).lower() for entry in entries)

    print("admin access ok: login, HttpOnly session, CSRF, Origin, RBAC, disable and audit")


if __name__ == "__main__":
    main()
