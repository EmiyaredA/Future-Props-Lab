from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
LFS_OID_PATTERN = re.compile(rb"^oid sha256:([0-9a-f]{64})$", re.MULTILINE)
ASSET_SUFFIXES = {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
ASSET_MANIFEST = Path("docs/assets/MANIFEST.md")
BACKEND_ASSETS = (
    Path("backend/app/galgame_workshop/assets/NotoSansSC-Regular.ttf"),
    Path("backend/app/galgame_workshop/assets/NotoSansSC-Medium.ttf"),
)
WEB_ASSETS = (
    Path("web/public/brand/presentation-workshop-mark.png"),
    Path("web/public/brand/thought-workshop-mark.png"),
    Path("web/public/voice-vad/silero_vad_v5.onnx"),
    Path("web/public/voice-vad/ort-wasm-simd-threaded.wasm"),
)
EXPECTED_SHA256 = {
    Path(
        "web/public/brand/presentation-workshop-mark.png"
    ): "34895e659c9406789e9cadfe7aab0ea42f86ea3d55e868718d9714bec06357ec",
    Path(
        "web/public/brand/thought-workshop-mark.png"
    ): "4706bb94b1d94898ea52f63dfa5167cbda9ad34fe55a25857a4ed9b1e49a12c9",
    Path("backend/app/galgame_workshop/assets/NotoSansSC-Regular.ttf"): (
        "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"
    ),
    Path("backend/app/galgame_workshop/assets/NotoSansSC-Medium.ttf"): (
        "ca094f6b0001fb048ca39ddd797a0cdb0179e1e55c6561e111c49c3e6a61d7b7"
    ),
    Path("web/public/voice-vad/silero_vad_v5.onnx"): (
        "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f"
    ),
    Path("web/public/voice-vad/ort-wasm-simd-threaded.wasm"): (
        "d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6"
    ),
}


def require_git_lfs() -> None:
    if shutil.which("git-lfs") is None:
        raise SystemExit(
            "Git LFS is required. Install it, run `git lfs install`, then pull the "
            "required runtime assets."
        )
    result = subprocess.run(
        ["git", "lfs", "version"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
        text=True,
    )
    if result.returncode:
        raise SystemExit(
            "Git LFS is installed but unavailable to Git. Run `git lfs install` and retry."
        )


def require_materialized(paths: tuple[Path, ...], include: str) -> None:
    invalid: list[str] = []
    for relative_path in paths:
        path = REPO_ROOT / relative_path
        try:
            with path.open("rb") as source:
                prefix = source.read(len(LFS_POINTER_PREFIX))
        except FileNotFoundError:
            invalid.append(f"{relative_path}（缺失）")
            continue
        if prefix == LFS_POINTER_PREFIX:
            invalid.append(f"{relative_path}（仍是 LFS 指针）")
            continue
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != EXPECTED_SHA256[relative_path]:
            invalid.append(f"{relative_path}（校验值不匹配）")
    if invalid:
        formatted = "\n  - ".join(invalid)
        raise SystemExit(
            "Required Git LFS objects are not materialized:\n"
            f"  - {formatted}\n"
            f'Run `git lfs pull --include="{include}" --exclude=""` and retry.'
        )


def check_pointers() -> None:
    result = subprocess.run(
        ["git", "lfs", "fsck", "--pointers"],
        cwd=REPO_ROOT,
        check=False,
    )
    if result.returncode:
        raise SystemExit(result.returncode)


def asset_digest(path: Path) -> str:
    content = path.read_bytes()
    if content.startswith(LFS_POINTER_PREFIX):
        match = LFS_OID_PATTERN.search(content)
        if match is None:
            raise ValueError("LFS 指针缺少 sha256 OID")
        return match.group(1).decode("ascii")
    return hashlib.sha256(content).hexdigest()


def manifest_assets(scope: str) -> list[Path]:
    if "*" in scope:
        candidates = REPO_ROOT.glob(scope)
    else:
        candidates = (REPO_ROOT / scope).rglob("*")
    return sorted(
        path for path in candidates if path.is_file() and path.suffix.lower() in ASSET_SUFFIXES
    )


def check_asset_manifest() -> None:
    rows: list[tuple[str, int, str]] = []
    source = (REPO_ROOT / ASSET_MANIFEST).read_text(encoding="utf-8")
    for line in source.splitlines():
        if not (line.startswith("| `docs/") or line.startswith("| `web/public/docs/")):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 6:
            continue
        scope = cells[0].strip("`")
        try:
            count = int(cells[1])
        except ValueError:
            continue
        digest = cells[5].strip("`")
        if re.fullmatch(r"[0-9a-f]{64}", digest):
            rows.append((scope, count, digest))
    if not rows:
        raise SystemExit(f"{ASSET_MANIFEST} 未找到可校验的文档素材行")

    invalid: list[str] = []
    for scope, expected_count, expected_digest in rows:
        assets = manifest_assets(scope)
        try:
            digest_lines = [
                f"{asset_digest(path)}  {path.relative_to(REPO_ROOT).as_posix()}" for path in assets
            ]
        except ValueError as exc:
            invalid.append(f"{scope}（{exc}）")
            continue
        aggregate = hashlib.sha256(("\n".join(digest_lines) + "\n").encode()).hexdigest()
        if len(assets) != expected_count or aggregate != expected_digest:
            invalid.append(
                f"{scope}（清单 {expected_count}/{expected_digest}，"
                f"实际 {len(assets)}/{aggregate}）"
            )
    if invalid:
        formatted = "\n  - ".join(invalid)
        raise SystemExit(f"Documentation asset manifest is stale:\n  - {formatted}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查 Git LFS 工具、指针和运行资产")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--tool", action="store_true", help="只检查 Git LFS 是否可用")
    scope.add_argument("--backend", action="store_true", help="检查后端固定字体")
    scope.add_argument("--web", action="store_true", help="检查 Web VAD 运行资产")
    scope.add_argument("--all", action="store_true", help="检查全部运行资产")
    scope.add_argument("--pointers", action="store_true", help="检查 LFS 指针规范性和文档素材清单")
    scope.add_argument("--manifest", action="store_true", help="只检查文档素材清单")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    require_git_lfs()
    if args.tool:
        return
    if args.pointers:
        check_pointers()
        check_asset_manifest()
        return
    if args.manifest:
        check_asset_manifest()
        return
    if args.backend or args.all:
        require_materialized(
            BACKEND_ASSETS,
            "backend/app/galgame_workshop/assets/*.ttf",
        )
    if args.web or args.all:
        require_materialized(
            WEB_ASSETS,
            "web/public/voice-vad/*,web/public/brand/thought-workshop-mark.png,"
            "web/public/brand/presentation-workshop-mark.png",
        )


if __name__ == "__main__":
    main()
