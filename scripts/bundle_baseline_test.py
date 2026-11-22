#!/usr/bin/env python3
"""Compare current initial JS payload with the pre-refactor taskbook baseline."""

from __future__ import annotations

import gzip
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CURRENT_IMAGE = os.environ.get("TEST_IMAGE", "szyca:release-test")
BASELINE_COMMIT = os.environ.get("BASELINE_COMMIT", "67e25fe")
BASELINE_IMAGE = "szyca:bundle-baseline"
REPORT = Path(os.environ.get("BUNDLE_REPORT", "artifacts/perf/bundle-size.json"))


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, cwd=ROOT, check=True, capture_output=True, **kwargs)


def build_baseline() -> None:
    archive = run(["git", "archive", "--format=tar", BASELINE_COMMIT]).stdout
    temp_dir = Path(tempfile.mkdtemp(prefix="szyca-bundle-baseline-"))
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
            bundle.extractall(temp_dir)
        run([
            "docker", "build",
            "-f", str(temp_dir / "deploy/Dockerfile"),
            "-t", BASELINE_IMAGE,
            str(temp_dir),
        ])
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def extract_web(image: str) -> tuple[Path, str]:
    temp_dir = Path(tempfile.mkdtemp(prefix="szyca-web-"))
    container = "szyca-bundle-extract"
    subprocess.run(["docker", "rm", "-f", container], capture_output=True)
    run(["docker", "create", "--name", container, "--entrypoint", "/bin/true", image])
    try:
        run(["docker", "cp", f"{container}:/app/web", str(temp_dir / "web")])
        index = (temp_dir / "web/index.html").read_text(encoding="utf-8")
        return temp_dir, index
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True)


def main_payload(index_html: str, web_root: Path) -> dict:
    paths = set(re.findall(r'(?:src|href)="(/assets/[^"]+\.js)"', index_html))
    raw_total = 0
    gzip_total = 0
    files = []
    for url_path in sorted(paths):
        file_path = web_root / url_path.lstrip("/")
        raw = file_path.read_bytes()
        compressed = gzip.compress(raw, compresslevel=9)
        raw_total += len(raw)
        gzip_total += len(compressed)
        files.append({
            "path": url_path,
            "raw_bytes": len(raw),
            "gzip_bytes": len(compressed),
        })
    return {"raw_bytes": raw_total, "gzip_bytes": gzip_total, "files": files}


def measure(image: str) -> dict:
    temp_dir, index = extract_web(image)
    try:
        return main_payload(index, temp_dir / "web")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def main() -> None:
    build_baseline()
    baseline = measure(BASELINE_IMAGE)
    current = measure(CURRENT_IMAGE)
    growth = (current["raw_bytes"] / baseline["raw_bytes"] - 1) * 100
    assert growth <= 10, f"initial JS grew {growth:.1f}% (limit 10%)"
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "baseline_commit": BASELINE_COMMIT,
                "current_image": CURRENT_IMAGE,
                "baseline": baseline,
                "current": current,
                "raw_growth_percent": growth,
                "criterion": "initial JS growth <= 10%",
                "passed": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"bundle ok: baseline {baseline['raw_bytes']} B, current {current['raw_bytes']} B, "
        f"growth {growth:.1f}%"
    )


if __name__ == "__main__":
    main()
