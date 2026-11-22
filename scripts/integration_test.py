#!/usr/bin/env python3
"""Docker 隔离栈端到端回归：题库脱敏、题序/唯一计分、时限、榜单、导出与并发约束。"""

from __future__ import annotations

import csv
import http.cookiejar
import io
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("BASE_URL", "http://localhost:8091").rstrip("/")
ADMIN = os.environ.get("ADMIN_PASSWORD", "integrity-test")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "owner")
PROJECT = os.environ.get("COMPOSE_PROJECT", "stpt-integrity-test")
PG_USER = os.environ.get("POSTGRES_USER", "szyca")
PG_DB = os.environ.get("POSTGRES_DB", "szyca")
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "szyca")
ADMIN_COOKIE_JAR = http.cookiejar.CookieJar()
ADMIN_OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(ADMIN_COOKIE_JAR))
ADMIN_CSRF = ""


def http(
    method: str,
    path: str,
    body: object | None = None,
    headers: dict[str, str] | None = None,
    raw: bool = False,
) -> tuple[int, object]:
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    if raw:
        return status, payload.decode("utf-8-sig")
    try:
        return status, json.loads(payload or b"{}")
    except json.JSONDecodeError:
        return status, payload.decode()


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
            PG_USER,
            "-d",
            PG_DB,
            "-Atc",
            query,
        ],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def admin_http(
    method: str,
    path: str,
    body: object | None = None,
    raw: bool = False,
) -> tuple[int, object]:
    data = None
    headers = {"Origin": BASE}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if ADMIN_CSRF and method not in {"GET", "HEAD", "OPTIONS"}:
        headers["X-CSRF-Token"] = ADMIN_CSRF
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with ADMIN_OPENER.open(req, timeout=10) as resp:
            payload = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    if raw:
        return status, payload.decode("utf-8-sig")
    try:
        return status, json.loads(payload or b"{}")
    except json.JSONDecodeError:
        return status, payload.decode(errors="replace")


def admin_login() -> None:
    global ADMIN_CSRF
    status, payload = admin_http(
        "POST",
        "/api/admin/auth/login",
        {"username": ADMIN_USERNAME, "password": ADMIN},
    )
    expect(status, payload, 200, "管理员登录")
    ADMIN_CSRF = payload["csrf_token"]


def correct_option(question_id: int, options: list[str]) -> str:
    value = psql(f"SELECT options->>answer FROM questions WHERE id = {question_id}")
    assert value, f"题目 {question_id} 不存在"
    assert value in options, f"题目 {question_id} 正确选项不在公开选项中"
    return value


def wait_ready() -> None:
    deadline = time.time() + 45
    while time.time() < deadline:
        try:
            status, _ = http("GET", "/healthz")
            if status == 200:
                return
        except OSError:
            pass
        time.sleep(1)
    raise TimeoutError("隔离栈未在 45 秒内就绪")


def check_ws_origin() -> None:
    def probe(origin: str) -> str:
        request = (
            "GET /ws HTTP/1.1\r\n"
            f"Host: {BASE.removeprefix('http://')}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"Origin: {origin}\r\n\r\n"
        )
        host = BASE.removeprefix("http://").split(":", 1)[0]
        port = int(BASE.rsplit(":", 1)[-1])
        with socket.create_connection((host, port), timeout=5) as sock:
            sock.sendall(request.encode())
            return sock.recv(256).decode("latin-1").split("\r\n", 1)[0]

    assert " 403 " in probe("https://evil.example"), "恶意 WebSocket Origin 未被拒绝"
    assert " 101 " in probe(BASE), "同源 WebSocket 握手失败"


def main() -> None:
    wait_ready()
    legacy_status, _ = http(
        "GET",
        "/api/admin/overview",
        headers={"X-Admin-Token": ADMIN},
    )
    assert legacy_status == 401, "旧 X-Admin-Token 在迁移完成后仍可访问后台"
    admin_login()
    nickname = "测试" + uuid.uuid4().hex[:8]
    device = "it-" + uuid.uuid4().hex

    expect(*admin_http("POST", "/api/admin/quiz-state", {"state": "start"}), 200, "开始答题")
    session = expect(
        *http("POST", "/api/session", {"nickname": nickname, "device_fp": device}),
        200,
        "创建身份",
    )
    token = session["token"]
    started = expect(
        *http("POST", "/api/quiz/round", {"difficulty": "全部"}, auth(token)),
        200,
        "开始轮次",
    )
    questions = started["questions"]
    assert len(questions) == 10, "默认轮次题量不是 10"
    assert started.get("question_deadline"), "缺少服务端本题截止时间"
    assert all("answer" not in q for q in questions), "公开题目泄露了 answer 字段"

    first, second = questions[0], questions[1]
    status, payload = http(
        "POST",
        "/api/answer",
        {"request_id": str(uuid.uuid4()), "question_id": second["id"], "selected": 0},
        auth(token),
    )
    expect(status, payload, 409, "跳题应被拒绝")

    first_right = first["options"].index(correct_option(first["id"], first["options"]))
    request_id = str(uuid.uuid4())
    first_answer = expect(
        *http(
            "POST",
            "/api/answer",
            {"request_id": request_id, "question_id": first["id"], "selected": first_right},
            auth(token),
        ),
        200,
        "第一题正确提交",
    )
    assert first_answer["correct"] is True and first_answer["score"] > 0
    assert first_answer.get("next_deadline"), "提交成功未返回下一题截止时间"

    dup = expect(
        *http(
            "POST",
            "/api/answer",
            {"request_id": request_id, "question_id": first["id"], "selected": first_right},
            auth(token),
        ),
        200,
        "相同 request_id 幂等重试",
    )
    assert dup["duplicate"] is True
    status, payload = http(
        "POST",
        "/api/answer",
        {"request_id": str(uuid.uuid4()), "question_id": first["id"], "selected": first_right},
        auth(token),
    )
    expect(status, payload, 409, "同题换 request_id 应被拒绝")

    current = expect(*http("GET", "/api/quiz/current", headers=auth(token)), 200, "恢复当前轮")
    assert current["answered"] == 1, "当前题序未推进到第二题"

    expected_score = first_answer["score"]
    last_request = ""
    last_question_id = 0
    for q in questions[1:]:
        right = q["options"].index(correct_option(q["id"], q["options"]))
        last_request = str(uuid.uuid4())
        last_question_id = q["id"]
        answer = expect(
            *http(
                "POST",
                "/api/answer",
                {"request_id": last_request, "question_id": q["id"], "selected": right},
                auth(token),
            ),
            200,
            f"提交题目 {q['id']}",
        )
        expected_score += answer["score"]

    final_retry = expect(
        *http(
            "POST",
            "/api/answer",
            {"request_id": last_request, "question_id": last_question_id, "selected": 0},
            auth(token),
        ),
        200,
        "最后一题相同 request_id 幂等重试",
    )
    assert final_retry["duplicate"] is True

    me = expect(*http("GET", "/api/me", headers=auth(token)), 200, "查询个人成绩")
    assert me["score"] == expected_score, f"个人总分 {me['score']} != {expected_score}"
    assert me["correct"] == len(questions)

    row = None
    rank = None
    for _ in range(10):  # 全量榜按 1 秒节流刷新
        rank = expect(*http("GET", "/api/rank?top=99"), 200, "查询排行榜")
        row = next((e for e in rank["entries"] if e["nickname"] == nickname), None)
        if row and row["score"] == expected_score:
            break
        time.sleep(0.5)
    assert row and rank
    assert row["score"] == expected_score, (
        f"排行榜得分 {row['score']} != {expected_score}（{nickname}）"
    )

    status, exported = admin_http("GET", "/api/admin/export/scores", raw=True)
    assert status == 200
    csv_rows = list(csv.DictReader(io.StringIO(exported)))
    csv_row = next(r for r in csv_rows if r["昵称"] == nickname)
    assert int(csv_row["得分"]) == expected_score, "导出得分与页面不一致"
    assert int(csv_row["排名"]) == rank["entries"].index(row) + 1, "导出名次与页面不一致"

    # 新轮次等待超过 5 秒题时 + 2 秒网络宽限后必须拒绝。
    fresh = expect(
        *http("POST", "/api/quiz/round", {"difficulty": "全部"}, auth(token)),
        200,
        "超时测试轮次",
    )
    time.sleep(8)
    fresh_q = fresh["questions"][0]
    status, payload = http(
        "POST",
        "/api/answer",
        {"request_id": str(uuid.uuid4()), "question_id": fresh_q["id"], "selected": 0},
        auth(token),
    )
    expect(status, payload, 410, "超时答案应被拒绝")

    # 数据库唯一索引与接口共同保证高并发注册只成功一个。
    race_nick = "并发" + uuid.uuid4().hex[:8]

    def create(seed: int) -> int:
        status, _ = http(
            "POST",
            "/api/session",
            {"nickname": race_nick, "device_fp": f"race-{uuid.uuid4().hex}-{seed}"},
        )
        return status

    with ThreadPoolExecutor(max_workers=12) as pool:
        statuses = list(pool.map(create, range(12)))
    assert statuses.count(200) == 1, f"并发昵称注册成功数异常：{statuses}"

    check_ws_origin()

    for i in range(8):
        status, _ = http(
            "POST",
            "/api/admin/auth/login",
            {"username": "rate-limit-probe", "password": "wrong-password"},
            headers={"Origin": BASE, "X-Forwarded-For": "203.0.113.250"},
        )
        assert status == 401, f"第 {i + 1} 次错误口令应返回 401"
    status, _ = http(
        "POST",
        "/api/admin/auth/login",
        {"username": "rate-limit-probe", "password": "wrong-password"},
        headers={"Origin": BASE, "X-Forwarded-For": "203.0.113.250"},
    )
    assert status == 429, "后台连续错误口令未触发限流"

    print("integration ok: 题目脱敏、题序、幂等、唯一计分、服务端时限、分值榜单、导出、并发约束、WS Origin、后台限流")


if __name__ == "__main__":
    main()
