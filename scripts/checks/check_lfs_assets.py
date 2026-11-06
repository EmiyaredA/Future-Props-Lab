from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
LFS_OID_PATTERN = re.compile(rb"^oid sha256:([0-9a-f]{64})$", re.MULTILINE)
ASSET_SUFFIXES = {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}
ASSET_MANIFEST = Path("docs/assets/MANIFEST.md")
BACKEND_ASSETS = (
    Path("backend/studio/apps/media_rendering/local/assets/NotoSansSC-Regular.ttf"),
    Path("backend/studio/apps/media_rendering/local/assets/NotoSansSC-Medium.ttf"),
)
WEB_ASSETS = (
    Path("web/public/brand/loading/kurisu-run.webp"),
    Path("web/public/brand/loading/time-machine.webp"),
    Path("web/public/brand/loading/metal-upa.webp"),
    Path("web/public/brand/loading/dr-pepper.webp"),
    Path("web/public/brand/loading/pocket-watch.webp"),
    Path("web/public/brand/loading/divergence-meter.webp"),
    Path("web/public/brand/loading/flip-phone.webp"),
    Path("web/public/brand/loading/phonewave.webp"),
    Path("web/public/brand/loading/gel-banana.webp"),
    Path("web/public/brand/loading/kurisu-run.webm"),
    Path("web/public/brand/loading/kurisu-run.png"),
    Path("web/public/brand/home/kurisu-idle.webm"),
    Path("web/public/brand/home/kurisu-idle.png"),
    Path("web/public/presentation-templates/html-template.png"),
    Path("web/public/presentation-templates/report-background.png"),
    Path("web/public/presentation-templates/structured-template.png"),
    Path("web/public/presentation-templates/visual-generation.png"),
    Path("web/public/brand/amadeus/amadeus.fpllive2d"),
    Path("web/public/brand/amadeus/amadeus-poster.png"),
    Path("web/public/brand/amadeus/amadeus-stage-poster.png"),
    Path("web/public/brand/agent-workbench-mark.png"),
    Path("web/public/brand/audio-annotation-mark.png"),
    Path("web/public/brand/director-desk-mark.png"),
    Path("web/public/brand/presentation-workshop-mark.png"),
    Path("web/public/brand/thought-workshop-mark.png"),
    Path("web/public/brand/interview-assistant-mark.png"),
    Path("web/public/voice-vad/silero_vad_v5.onnx"),
    Path("web/public/voice-vad/ort-wasm-simd-threaded.wasm"),
)
EXPECTED_SHA256 = {
    Path(
        "web/public/brand/loading/kurisu-run.webp"
    ): "8f8b059ce99a4ae7e100551417515e16fc1d36bfa2926fbfd0ce72f8a3b10d85",
    Path(
        "web/public/brand/loading/time-machine.webp"
    ): "58167e6287c6bef52c27c3557b53bb142e82aa9842c5a3d6bfad2be9d631a0e1",
    Path(
        "web/public/brand/loading/metal-upa.webp"
    ): "694b68aac09b16ac7a3860cfa1b405a4ce31ef2f8a504e4f91d522ccb9d989e1",
    Path(
        "web/public/brand/loading/dr-pepper.webp"
    ): "f91268d91ab332eaccd987c6720cf6e03e92469153b5f0c2c4b84d8fad2dbaf7",
    Path(
        "web/public/brand/loading/pocket-watch.webp"
    ): "71533ba03e36c59d0c70ab7e00bbf2aa84c2f81ffcde974df98f27bd267f7ef9",
    Path(
        "web/public/brand/loading/divergence-meter.webp"
    ): "1525c21b83f59a21167168b2f1a5cf56230354cef7e90ee4f1ca83f5cca90ff1",
    Path(
        "web/public/brand/loading/flip-phone.webp"
    ): "35468fae7ed4fafbd14e780749e6919d6c4d1164edd661094053dee51b2b7056",
    Path(
        "web/public/brand/loading/phonewave.webp"
    ): "398a33a022f00d386c7bbec6719ec082977626e87aa5347f3d02c6c995dd6a81",
    Path(
        "web/public/brand/loading/gel-banana.webp"
    ): "f6093c10b8d0efd073ddec44da74666b2be00c1bbf716bbe640e952452cdde12",
    Path("web/public/brand/loading/kurisu-run.webm"): (
        "2731db585e6b7115f1cc660dade90cf5d3860746a5ab52888a3f27cc6ed51830"
    ),
    Path("web/public/brand/loading/kurisu-run.png"): (
        "45057d66398f8073ea903da2545b31d78161be11993202b7e9be78a775a1b689"
    ),
    Path(
        "web/public/brand/home/kurisu-idle.webm"
    ): "10717cdea36065ed9e6a0360a7174ff1a79b7dea9523939376980b5f74219132",
    Path(
        "web/public/brand/home/kurisu-idle.png"
    ): "32ee8bfef51fb8c0122f9bd9bdc030113310731a590b3dea672a7515fc0b8e0f",
    Path(
        "web/public/presentation-templates/html-template.png"
    ): "a7e045177e4a2a929242eb3d19f9f75f65ba7d0605b5cf7b366ee7495de31064",
    Path(
        "web/public/presentation-templates/report-background.png"
    ): "8764dfd16e900a269513238f8b0a9091afe759c3fa8f5373a0459aeff8bbf097",
    Path(
        "web/public/presentation-templates/structured-template.png"
    ): "79a17d73ce31893e308d8c19b5c0c20642b665bae11db890949865f0b99dbd39",
    Path(
        "web/public/presentation-templates/visual-generation.png"
    ): "63ee9a0da25572e40b4cf55834935b1cbc6e207281ff73ca7ee2cdeda5c33671",
    Path("web/public/brand/interview-assistant-mark.png"): (
        "94a126bece0c8a7593905347156abc800fa25ee946f16a3a17bba5f7dfba6074"
    ),
    Path("web/public/brand/amadeus/amadeus.fpllive2d"): (
        "9cd9d77c781fbe6d96e878cd48a5ac0709deeeb2b7e5ac876bc3d44d0ca97aac"
    ),
    Path("web/public/brand/amadeus/amadeus-poster.png"): (
        "80cd7211b946667667dc527536b25a8dee536896e887dcae1d280c20e524f441"
    ),
    Path("web/public/brand/amadeus/amadeus-stage-poster.png"): (
        "59baef48c4953e79f32fcbc9c86e9306fecb65ae554e50349048c41c3ab17465"
    ),
    Path(
        "web/public/brand/agent-workbench-mark.png"
    ): "e8b8839472bdfc9923aba39987568392d0619ad834e41b7c96cd039352d6eecd",
    Path(
        "web/public/brand/audio-annotation-mark.png"
    ): "a3539f2db85bdc42fdfab5dea9215b3ef1ce4e1c560bc9834d5c30feae015349",
    Path(
        "web/public/brand/director-desk-mark.png"
    ): "fec866de8e555d43d4faa4ae818bae1725b2cfc106e79affa6be2646c4235ee0",
    Path(
        "web/public/brand/presentation-workshop-mark.png"
    ): "34895e659c9406789e9cadfe7aab0ea42f86ea3d55e868718d9714bec06357ec",
    Path(
        "web/public/brand/thought-workshop-mark.png"
    ): "4706bb94b1d94898ea52f63dfa5167cbda9ad34fe55a25857a4ed9b1e49a12c9",
    Path("backend/studio/apps/media_rendering/local/assets/NotoSansSC-Regular.ttf"): (
        "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"
    ),
    Path("backend/studio/apps/media_rendering/local/assets/NotoSansSC-Medium.ttf"): (
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
    mismatched: list[str] = []
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
            mismatched.append(str(relative_path))
    if mismatched:
        formatted = "\n  - ".join(mismatched)
        raise SystemExit(
            "Runtime asset SHA256 does not match the asset manifest:\n"
            f"  - {formatted}\n"
            "Compare the working files with committed LFS OIDs and update the "
            "asset manifest only for verified asset changes."
        )
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
    mismatched: list[str] = []
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
    if mismatched:
        formatted = "\n  - ".join(mismatched)
        raise SystemExit(
            "Runtime asset SHA256 does not match the asset manifest:\n"
            f"  - {formatted}\n"
            "Compare the working files with committed LFS OIDs and update the "
            "asset manifest only for verified asset changes."
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
            "backend/studio/apps/media_rendering/local/assets/*.ttf",
        )
    if args.web or args.all:
        require_materialized(
            WEB_ASSETS,
            "web/public/presentation-templates/*,web/public/voice-vad/*,web/public/brand/home/*,web/public/brand/loading/*,web/public/brand/thought-workshop-mark.png,"
            "web/public/brand/presentation-workshop-mark.png,"
            "web/public/brand/audio-annotation-mark.png,"
            "web/public/brand/director-desk-mark.png,web/public/brand/agent-workbench-mark.png,"
            "web/public/brand/amadeus/amadeus.fpllive2d,web/public/brand/amadeus/amadeus-poster.png,web/public/brand/amadeus/amadeus-stage-poster.png",
        )


if __name__ == "__main__":
    main()
