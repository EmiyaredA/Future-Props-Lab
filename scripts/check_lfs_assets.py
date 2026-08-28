from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
BACKEND_ASSETS = (
    Path("backend/app/galgame_workshop/assets/NotoSansSC-Regular.ttf"),
    Path("backend/app/galgame_workshop/assets/NotoSansSC-Medium.ttf"),
)
WEB_ASSETS = (
    Path("web/public/voice-vad/silero_vad_v5.onnx"),
    Path("web/public/voice-vad/ort-wasm-simd-threaded.wasm"),
)
EXPECTED_SHA256 = {
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查 Git LFS 工具、指针和运行资产")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--tool", action="store_true", help="只检查 Git LFS 是否可用")
    scope.add_argument("--backend", action="store_true", help="检查后端固定字体")
    scope.add_argument("--web", action="store_true", help="检查 Web VAD 运行资产")
    scope.add_argument("--all", action="store_true", help="检查全部运行资产")
    scope.add_argument("--pointers", action="store_true", help="检查 LFS 指针规范性")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    require_git_lfs()
    if args.tool:
        return
    if args.pointers:
        check_pointers()
        return
    if args.backend or args.all:
        require_materialized(
            BACKEND_ASSETS,
            "backend/app/galgame_workshop/assets/*.ttf",
        )
    if args.web or args.all:
        require_materialized(WEB_ASSETS, "web/public/voice-vad/*")


if __name__ == "__main__":
    main()
