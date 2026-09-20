"""Build an allowlisted, self-contained arm64 backend; never read user runtime/config."""

from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "desktop/build"
POINTER = b"version https://git-lfs.github.com/spec/v1"
RUNNER_STDLIB_EXCLUDED = {
    "ensurepip",
    "idlelib",
    "lib2to3",
    "pydoc_data",
    "test",
    "tkinter",
    "turtle",
    "turtledemo",
    "venv",
}


def runner_stdlib_args() -> list[str]:
    """Frozen exec() cannot discover imports in conversation scripts during analysis."""
    args: list[str] = []
    for name in sorted(sys.stdlib_module_names - RUNNER_STDLIB_EXCLUDED):
        spec = importlib.util.find_spec(name)
        if spec is None:
            continue
        if spec.submodule_search_locations:
            args.extend(("--collect-submodules", name))
        else:
            args.extend(("--hidden-import", name))
    return args


def run(*args: str, **kwargs) -> str:
    return subprocess.check_output(args, text=True, cwd=ROOT, **kwargs).strip()


def required_assets() -> None:
    paths = [
        *list((ROOT / "web/public").rglob("*")),
        *list((ROOT / "backend/app/capabilities/media_rendering/assets").rglob("*")),
    ]
    missing = []
    for file in paths:
        if file.is_file():
            with file.open("rb") as stream:
                if stream.read(len(POINTER)) == POINTER:
                    missing.append(str(file.relative_to(ROOT)))
    if missing:
        run("git", "lfs", "pull", "--include=" + ",".join(missing), "--exclude=")
    run(sys.executable, "scripts/check_lfs_assets.py", "--all")
    for file in paths:
        if file.is_file():
            with file.open("rb") as stream:
                if stream.read(len(POINTER)) == POINTER:
                    raise SystemExit(f"Unresolved LFS resource: {file.relative_to(ROOT)}")


def collect_notices(ffmpeg: str, ffprobe: str) -> Path:
    notices = BUILD / "notices"
    notices.mkdir(parents=True, exist_ok=True)
    metadata = {"python": sys.version, "platform": platform.platform(), "tools": {}}
    for tool in (ffmpeg, ffprobe):
        with open(tool, "rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        metadata["tools"][Path(tool).name] = {
            "version": run(tool, "-version"),
            "sha256": digest,
        }
    # Homebrew source metadata and installed licenses for the complete dylib closure.
    pending = [Path(ffmpeg).resolve(), Path(ffprobe).resolve()]
    visited = set()
    formulae = {}
    while pending:
        binary = pending.pop()
        if binary in visited:
            continue
        visited.add(binary)
        parts = binary.parts
        if "Cellar" in parts:
            index = parts.index("Cellar")
            package = Path(*parts[: index + 3])
            formulae[parts[index + 1]] = package
        for line in run("otool", "-L", str(binary)).splitlines()[1:]:
            dep = line.strip().split(" (", 1)[0]
            if dep.startswith("/") and not dep.startswith(("/System/", "/usr/lib/")):
                pending.append(Path(dep).resolve())
    for name, directory in formulae.items():
        destination = notices / name
        destination.mkdir(exist_ok=True)
        for file in directory.rglob("*"):
            if file.is_file() and (
                file.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "COPYRIGHT"))
                or file.name == "INSTALL_RECEIPT.json"
                or file.parent.name == ".brew"
            ):
                target = destination / file.relative_to(directory)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, target)
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name", "unknown")
        destination = notices / "python" / name
        for item in distribution.files or []:
            if ".dist-info" in str(item) and (
                "licenses/" in str(item)
                or item.name.upper().startswith(("LICENSE", "COPYING"))
                or item.name == "METADATA"
            ):
                destination.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(distribution.locate_file(item), destination / item.name)
    (notices / "build.json").write_text(json.dumps(metadata, indent=2) + "\n")
    lock = json.loads((ROOT / "package-lock.json").read_text())
    npm_licenses = []
    for name, package in lock["packages"].items():
        if not name.startswith("node_modules/") or package.get("dev"):
            continue
        npm_licenses.append(
            {"package": name, "version": package.get("version"), "license": package.get("license")}
        )
        for file in (ROOT / name).glob("*"):
            if file.is_file() and file.name.upper().startswith(
                ("LICENSE", "LICENCE", "COPYING", "NOTICE")
            ):
                destination = notices / "npm" / name.removeprefix("node_modules/") / file.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, destination)
    (notices / "npm-licenses.json").write_text(json.dumps(npm_licenses, indent=2) + "\n")
    return notices


def verify_bundle(directory: Path) -> None:
    inventory = []
    for file in sorted(directory.rglob("*")):
        if not file.is_file() or file.is_symlink():
            continue
        relative = file.relative_to(directory)
        if (
            file.name in {".env", "config.toml", ".config-migration.lock"}
            or file.name.startswith((".env.backup-", "config.toml.backup-", ".config-"))
            or ".runtime" in relative.parts
        ):
            raise SystemExit(f"Forbidden packaged resource: {relative}")
        description = run("file", "-b", str(file))
        if "Mach-O" in description:
            if "arm64" not in run("lipo", "-archs", str(file)):
                raise SystemExit(f"Not arm64: {relative}")
            links = run("otool", "-L", str(file))
            if "/opt/homebrew/" in links or "/usr/local/" in links:
                raise SystemExit(f"Unrelocated native dependency: {relative}\n{links}")
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        inventory.append({"path": str(relative), "sha256": digest, "bytes": file.stat().st_size})
    (directory / "resources-manifest.json").write_text(json.dumps(inventory, indent=2) + "\n")
    clean_env = {"PATH": "/usr/bin:/bin", "HOME": os.environ["HOME"]}
    run(str(directory / "_internal/bin/ffmpeg"), "-version", env=clean_env)
    run(str(directory / "_internal/bin/ffprobe"), "-version", env=clean_env)
    print(run(str(directory / "fpl-server"), "--self-test-resources", env=clean_env))


def main() -> None:
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise SystemExit("Desktop builds require a native Apple Silicon macOS runner")
    required_assets()
    tools = [shutil.which(name) for name in ("ffmpeg", "ffprobe")]
    if not all(tools):
        raise SystemExit("Build machine requires ffmpeg and ffprobe; end users do not")
    ffmpeg, ffprobe = tools
    notices = collect_notices(ffmpeg, ffprobe)
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        "fpl-server",
        "--target-arch",
        "arm64",
        "--distpath",
        str(BUILD / "backend"),
        "--workpath",
        str(BUILD / "pyinstaller"),
        "--specpath",
        str(BUILD),
        "--paths",
        str(ROOT / "backend"),
        "--paths",
        str(ROOT),
        "--collect-submodules",
        "app",
        "--collect-submodules",
        "db",
        "--collect-all",
        "pptx",
        "--collect-all",
        "resvg_py",
        "--collect-all",
        "aiosqlite",
        "--hidden-import",
        "sqlalchemy.dialects.sqlite.aiosqlite",
        "--add-binary",
        f"{ffmpeg}:bin",
        "--add-binary",
        f"{ffprobe}:bin",
        "--add-data",
        f"{notices}:third-party",
        "--add-data",
        (
            f"{ROOT / 'backend/app/capabilities/media_rendering/assets'}"
            ":app/capabilities/media_rendering/assets"
        ),
        "--add-data",
        (
            f"{ROOT / 'backend/app/console/governance/desktop_agent_operations.json'}"
            ":app/console/governance"
        ),
    ]
    docs = [ROOT / "README.md", ROOT / "CONTRIBUTING.md", ROOT / "docs/assets/MANIFEST.md"]
    for folder in ("architecture", "operations", "reference"):
        docs.extend(sorted((ROOT / "docs" / folder).glob("*.md")))
    for document in docs:
        args.extend(["--add-data", f"{document}:{document.relative_to(ROOT).parent}"])
    # Use isolated values and an absent config during module discovery.
    from cryptography.fernet import Fernet

    env = {key: value for key, value in os.environ.items() if not key.startswith("FPL_")}
    env["FPL_SECRETS_KEY"] = Fernet.generate_key().decode()
    env["FPL_DATABASE_PATH"] = str(BUILD / "analysis-only.db")
    env["FPL_CONFIG_FILE"] = str(BUILD / "analysis-only-config.toml")
    subprocess.run([*args, str(ROOT / "desktop/backend/entry.py")], cwd=ROOT, env=env, check=True)
    verify_bundle(BUILD / "backend/fpl-server")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--name",
            "fpl",
            "--target-arch",
            "arm64",
            "--distpath",
            str(BUILD / "cli"),
            "--workpath",
            str(BUILD / "cli-pyinstaller"),
            "--specpath",
            str(BUILD),
            "--paths",
            str(ROOT / "sdk/python/src"),
            "--collect-submodules",
            "future_props_lab",
            str(ROOT / "desktop/backend/cli_entry.py"),
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )
    print(run(str(BUILD / "cli/fpl/fpl"), "--help", env={"PATH": "/usr/bin:/bin"}))
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--name",
            "fpl-script-runner",
            "--target-arch",
            "arm64",
            "--distpath",
            str(BUILD / "runner"),
            "--workpath",
            str(BUILD / "runner-pyinstaller"),
            "--specpath",
            str(BUILD),
            *runner_stdlib_args(),
            str(ROOT / "desktop/backend/script_entry.py"),
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )


if __name__ == "__main__":
    if sys.argv[1:] == ["--check-assets"]:
        required_assets()
    else:
        main()
