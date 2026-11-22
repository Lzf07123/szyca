#!/usr/bin/env python3
"""Validate the public site contract, module gates, CORS and media references."""

from __future__ import annotations

import base64
import http.cookiejar
import json
import os
import uuid
import urllib.error
import urllib.request


BASE = os.environ.get("BASE_URL", "http://localhost:8092").rstrip("/")
USERNAME = os.environ.get("ADMIN_USERNAME", "owner")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "foundation-test")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X7n6WQAAAABJRU5ErkJggg=="
)


class Session:
    def __init__(self) -> None:
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self.csrf = ""

    def call(
        self,
        method: str,
        path: str,
        *,
        body: object | None = None,
        data: bytes | None = None,
        content_type: str = "application/json",
        include_csrf: bool = True,
        origin: str = BASE,
    ) -> tuple[int, object, dict[str, str]]:
        headers = {"Origin": origin}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = content_type
        elif data is not None:
            headers["Content-Type"] = content_type
        if include_csrf and self.csrf and method not in {"GET", "HEAD", "OPTIONS"}:
            headers["X-CSRF-Token"] = self.csrf
        request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read()
                status = response.status
                response_headers = dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            status = exc.code
            response_headers = dict(exc.headers.items())
        try:
            payload: object = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = raw.decode(errors="replace")
        return status, payload, response_headers


def expect(status: int, payload: object, want: int, label: str) -> object:
    assert status == want, f"{label}: HTTP {status}, want {want}: {payload}"
    return payload


def login() -> Session:
    session = Session()
    status, payload, _ = session.call(
        "POST",
        "/api/admin/auth/login",
        body={"username": USERNAME, "password": PASSWORD},
        include_csrf=False,
    )
    expect(status, payload, 200, "admin login")
    session.csrf = payload["csrf_token"]
    return session


def public_call(path: str, headers: dict[str, str] | None = None) -> tuple[int, object, dict[str, str]]:
    request = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = raw.decode(errors="replace")
        return exc.code, payload, dict(exc.headers.items())


def multipart_upload(session: Session) -> str:
    boundary = "----szyca-" + uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="pixel.png"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
    status, payload, _ = session.call(
        "POST",
        "/api/admin/uploads",
        data=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    expect(status, payload, 200, "upload PNG")
    return payload["url"]


def set_quiz_feature(session: Session, enabled: bool) -> None:
    status, payload, _ = session.call(
        "PUT",
        "/api/admin/platform/features",
        body={
            "features": [
                {
                    "key": "quiz",
                    "enabled": enabled,
                    "config": {},
                }
            ]
        },
    )
    expect(status, payload, 200, f"set quiz feature {enabled}")


def main() -> None:
    first_status, first_site, first_headers = public_call("/api/site")
    expect(first_status, first_site, 200, "public site")
    for field in ("brand", "nav", "footer", "features", "sections", "backgrounds", "qrcodes"):
        assert field in first_site, f"/api/site missing {field}"
    etag = first_headers.get("Etag") or first_headers.get("ETag")
    assert etag, "GET /api/site did not return ETag"
    second_status, _, _ = public_call("/api/site", {"If-None-Match": etag})
    assert second_status == 304, f"ETag request returned {second_status}"

    origin_status, origin_payload, origin_headers = public_call(
        "/api/site", {"Origin": "https://evil.example"}
    )
    expect(origin_status, origin_payload, 200, "cross-origin public read")
    assert origin_headers.get("Access-Control-Allow-Origin") != "*"

    session = login()
    asset_url = multipart_upload(session)

    status, payload, _ = session.call(
        "POST", "/api/admin/logo", body={"logo_url": asset_url}
    )
    expect(status, payload, 200, "attach logo")

    status, footer, _ = session.call("GET", "/api/admin/footer")
    expect(status, footer, 200, "read footer")
    footer = footer["footer"]
    footer["icp_icon"] = asset_url
    status, payload, _ = session.call("POST", "/api/admin/footer", body=footer)
    expect(status, payload, 200, "attach same image to footer")

    status, media, _ = session.call("GET", "/api/admin/media")
    expect(status, media, 200, "list media")
    asset = next(item for item in media["assets"] if item["path"] == asset_url)
    assert len(asset["refs"]) >= 2, asset
    status, payload, _ = session.call("DELETE", f"/api/admin/media/{asset['id']}")
    assert status == 409 and payload.get("code") == "media_in_use", payload

    status, payload, _ = session.call(
        "POST", "/api/admin/logo", body={"logo_url": ""}
    )
    expect(status, payload, 200, "release logo")
    footer["icp_icon"] = ""
    status, payload, _ = session.call("POST", "/api/admin/footer", body=footer)
    expect(status, payload, 200, "release footer icon")
    status, payload, _ = session.call("DELETE", f"/api/admin/media/{asset['id']}")
    expect(status, payload, 200, "delete unreferenced media")

    try:
        set_quiz_feature(session, False)
        status, disabled_site, _ = public_call("/api/site")
        expect(status, disabled_site, 200, "site after quiz disabled")
        assert all(item["to"] != "/quiz" for item in disabled_site["nav"]), disabled_site["nav"]
        assert all(section["kind"] != "quiz" for section in disabled_site["sections"])

        request = urllib.request.Request(
            BASE + "/api/session",
            data=json.dumps({"nickname": "disabled-check", "device_fp": uuid.uuid4().hex}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=10)
            raise AssertionError("disabled quiz session unexpectedly succeeded")
        except urllib.error.HTTPError as exc:
            payload = json.loads(exc.read() or b"{}")
            assert exc.code == 404 and payload.get("code") == "feature_disabled", payload
    finally:
        set_quiz_feature(session, True)

    request = urllib.request.Request(
        BASE + "/api/admin/site/sections",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "PUT",
        },
        method="OPTIONS",
    )
    try:
        urllib.request.urlopen(request, timeout=10)
        raise AssertionError("foreign preflight unexpectedly succeeded")
    except urllib.error.HTTPError as exc:
        assert exc.code == 403, exc.code
        assert exc.headers.get("Access-Control-Allow-Origin") != "*"

    print("site/media ok: single contract, ETag 304, feature gates, strict CORS and reference protection")


if __name__ == "__main__":
    main()
