#!/usr/bin/env python3
"""Export and verify szyca's project-owned deep-space design template."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_DIR = ROOT / "design-system/szyca/template"
TOKEN_SOURCE = ROOT / "frontend/src/index.css"
COMPONENT_SOURCE = ROOT / "frontend/src/cosmos.css"
TEMPLATE_VERSION = "1.0.6"
ALIAS_MARKER = "/* Backward-compatible aliases consumed by existing business pages. */"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def css_block(source: str, selector: str) -> str:
    match = re.search(rf"{re.escape(selector)}\s*\{{(.*?)\n\}}", source, re.S)
    if not match:
        raise ValueError(f"CSS block not found: {selector}")
    return match.group(1)


def css_variables(source: str) -> list[tuple[str, str]]:
    return [
        (match.group(1), match.group(2).strip())
        for match in re.finditer(r"^\s*(--[a-z0-9_-]+)\s*:\s*(.+?);\s*$", source, re.M | re.I)
    ]


def token_type(name: str, value: str) -> str:
    lowered = name.lower()
    if lowered in {"--font-sans", "--font-display", "--font-mono"}:
        return "fontFamily"
    if "shadow" in lowered:
        return "shadow"
    if lowered in {"--ease-out"}:
        return "cubicBezier"
    if lowered.startswith("--motion-"):
        return "duration"
    if (
        lowered.startswith("--radius-")
        or lowered.startswith("--space-")
        or lowered in {
            "--grid-size",
            "--header-height",
            "--page-gutter",
            "--page-max",
            "--section-space",
            "--section-heading-space",
            "--page-tail-space",
        }
    ):
        return "dimension"
    if value.startswith(("#", "rgb", "hsl", "color(")):
        return "color"
    if value.startswith("var(") and any(
        part in lowered
        for part in (
            "color",
            "bg",
            "accent",
            "text",
            "line",
            "surface",
            "success",
            "warning",
            "error",
            "brand",
            "solar",
            "danger",
            "ink",
            "paper",
            "particle",
        )
    ):
        return "color"
    return "string"


def token_map(entries: list[tuple[str, str]], layer: str) -> dict[str, dict]:
    return {
        name: {
            "$value": value,
            "$type": token_type(name, value),
            "$extensions": {"layer": layer},
        }
        for name, value in entries
    }


def tokens_payload(index_css: str) -> dict:
    root = css_block(index_css, ":root")
    core, separator, aliases = root.partition(ALIAS_MARKER)
    if not separator:
        raise ValueError("compatibility alias marker not found in index.css")
    core_tokens = css_variables(core)
    primitive_entries = [(name, value) for name, value in core_tokens if not value.startswith("var(")]
    semantic_entries = [(name, value) for name, value in core_tokens if value.startswith("var(")]
    fullscreen = css_variables(css_block(index_css, ".app.fullscreen"))
    return {
        "$schema": "https://design-tokens.github.io/community-group/format/",
        "$metadata": {
            "name": "szyca-deep-space",
            "displayName": "szyca 数字深空",
            "version": TEMPLATE_VERSION,
            "ownership": "project",
            "derivedFrom": None,
            "sharedSubmodule": False,
            "runtimeTokenSource": "frontend/src/index.css",
            "runtimeComponentSource": "frontend/src/cosmos.css",
        },
        "primitive": token_map(primitive_entries, "primitive"),
        "semantic": token_map(semantic_entries, "semantic"),
        "compatibility": token_map(css_variables(aliases), "compatibility"),
        "modes": {
            "fullscreen": {
                "description": "全屏排行榜模式",
                "tokens": token_map(fullscreen, "component"),
            },
        },
    }


def render_css_snapshot(source: str, source_path: str, source_hash: str) -> str:
    return (
        "/*!\n"
        f" * szyca · Digital Deep Space template v{TEMPLATE_VERSION}\n"
        " * Project-owned visual layer; no Li&Design submodule dependency.\n"
        f" * Generated snapshot from {source_path}\n"
        f" * source-sha256: {source_hash}\n"
        " * Do not edit directly. Run scripts/export_design_template.py --write.\n"
        " */\n"
        f"{source.rstrip()}\n"
    )


def expected_files() -> dict[Path, str]:
    index_css = read(TOKEN_SOURCE)
    components_css = read(COMPONENT_SOURCE)
    tokens_css = render_css_snapshot(
        index_css,
        "frontend/src/index.css",
        digest(index_css),
    )
    components_snapshot = render_css_snapshot(
        components_css,
        "frontend/src/cosmos.css",
        digest(components_css),
    )
    tokens_json = json.dumps(tokens_payload(index_css), ensure_ascii=False, indent=2) + "\n"
    manifest = {
        "id": "szyca-deep-space",
        "name": "szyca 数字深空",
        "version": TEMPLATE_VERSION,
        "ownership": "project",
        "derivedFrom": None,
        "sharedSubmodule": False,
        "canonical": {
            "brand": "design-system/szyca/BRAND.md",
            "master": "design-system/szyca/MASTER.md",
            "runtimeTokens": "frontend/src/index.css",
            "runtimeComponents": "frontend/src/cosmos.css",
            "runtimeHome": "frontend/src/pages/Home.tsx",
            "runtimeCanvas": "frontend/src/components/CosmicBackdrop.tsx",
        },
        "exports": {
            "tokensCss": "tokens.css",
            "tokensJson": "tokens.json",
            "componentsCss": "components.css",
        },
        "fonts": {
            "sans": "Noto Sans SC Variable",
            "display": "Space Grotesk Variable",
            "mono": "JetBrains Mono Variable",
        },
        "signature": {
            "grid": "56px",
            "particleNodes": 90,
            "particleLinkDistance": 110,
            "pointerGravityDistance": 190,
            "mobileBreakpoint": 820,
        },
        "hashes": {
            "tokensSource": digest(index_css),
            "componentsSource": digest(components_css),
            "tokensCss": digest(tokens_css),
            "tokensJson": digest(tokens_json),
            "componentsCss": digest(components_snapshot),
        },
    }
    return {
        TEMPLATE_DIR / "tokens.css": tokens_css,
        TEMPLATE_DIR / "components.css": components_snapshot,
        TEMPLATE_DIR / "tokens.json": tokens_json,
        TEMPLATE_DIR / "manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    }


def validate_boundary() -> list[str]:
    errors: list[str] = []
    modules = ROOT / ".gitmodules"
    if modules.exists() and "li-design" in read(modules).lower():
        errors.append(".gitmodules still references Li&Design")
    for path in (ROOT / "frontend/src").rglob("*"):
        if not path.is_file() or path.suffix not in {".css", ".json", ".ts", ".tsx"}:
            continue
        if re.search(r"li[-&]design", read(path), re.I):
            errors.append(f"runtime source references Li&Design: {path.relative_to(ROOT)}")
    return errors


def write_files(files: dict[Path, str]) -> None:
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    for path, content in files.items():
        path.write_text(content, encoding="utf-8")
    print(f"wrote {len(files)} files to {TEMPLATE_DIR.relative_to(ROOT)}")


def check_files(files: dict[Path, str]) -> list[str]:
    errors = validate_boundary()
    for path, expected in files.items():
        if not path.exists():
            errors.append(f"missing template file: {path.relative_to(ROOT)}")
        elif read(path) != expected:
            errors.append(f"stale template snapshot: {path.relative_to(ROOT)}")
    if TEMPLATE_DIR.exists() and not (TEMPLATE_DIR / "README.md").exists():
        errors.append("missing template README.md")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--write", action="store_true", help="regenerate the project template")
    action.add_argument("--check", action="store_true", help="verify snapshot freshness and ownership")
    args = parser.parse_args()
    files = expected_files()
    if args.write:
        write_files(files)
        return 0
    errors = check_files(files)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(
        "design template ok: project-owned, no Li&Design submodule, "
        f"v{TEMPLATE_VERSION}, {len(files)} generated artifacts current"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
