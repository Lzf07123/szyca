#!/usr/bin/env python3
"""Measure the public /api/site contract under 100 concurrent requests."""

from __future__ import annotations

import json
import math
import os
import statistics
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


BASE = os.environ.get("BASE_URL", "http://localhost:8091").rstrip("/")
REPORT = Path(os.environ.get("SITE_PERF_REPORT", "artifacts/perf/site-perf.json"))


def request_site(if_none_match: str = "") -> tuple[int, float, str]:
    headers = {"If-None-Match": if_none_match} if if_none_match else {}
    request = urllib.request.Request(BASE + "/api/site", headers=headers)
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()
        latency = (time.perf_counter() - started) * 1000
        return response.status, latency, response.headers.get("ETag", "")


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * quantile) - 1)]


def main() -> None:
    status, _, etag = request_site()
    assert status == 200 and etag, (status, etag)
    with ThreadPoolExecutor(max_workers=100) as pool:
        results = list(pool.map(request_site, [""] * 100))
    statuses = [status for status, _, _ in results]
    assert statuses.count(200) == 100, statuses
    latencies = [latency for _, latency, _ in results]
    p95 = percentile(latencies, 0.95)
    p99 = percentile(latencies, 0.99)
    assert p95 < 100, f"/api/site P95 {p95:.1f}ms exceeds 100ms"
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "requests": len(latencies),
                "p50_ms": statistics.median(latencies),
                "p95_ms": p95,
                "p99_ms": p99,
                "max_ms": max(latencies),
                "criterion": "P95 < 100ms",
                "passed": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        "site perf ok: 100 concurrent, P95="
        f"{p95:.1f}ms P99={p99:.1f}ms median={statistics.median(latencies):.1f}ms"
    )


if __name__ == "__main__":
    main()
