"""Publish initial website connection configuration against its verified offline snapshot."""

import argparse
import contextlib
import hashlib
import os
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

from scripts.website.data_transfer import digest, locked  # noqa: E402


def publish(snapshot, *, public_enabled=None):
    from app.runtime.config import Settings
    from studio.config import read_config
    from studio.config.migration import encode

    runtime = ROOT / ".runtime"
    path = ROOT / "backend/config.toml"
    original = path.read_bytes()
    document = tomllib.loads(original.decode())
    expected = snapshot / "desktop-snapshot/runtime/future-props.db"
    if not expected.is_file():
        raise ValueError("缺少网站化完整停机快照")
    with contextlib.ExitStack() as stack:
        stack.enter_context(locked(runtime / "website.lock"))
        legacy = Path(document["website"]["legacy_data_root"])
        stack.enter_context(locked(legacy / "backend.lock"))
        if digest(runtime / "future-props.db") != digest(expected):
            raise ValueError("正式数据已经变化，请先完成新的完整停机快照")
        backup = snapshot / (
            "website-config-before-" + hashlib.sha256(original).hexdigest()[:16] + ".toml"
        )
        if not backup.exists():
            with backup.open("xb") as stream:
                stream.write(original)
            backup.chmod(0o600)
        document.setdefault("remote_web", {})["web_root"] = str(ROOT / ".local/studio-release")
        if public_enabled is not None:
            document["website"]["public_enabled"] = public_enabled
        temporary = path.with_name(".website-config.tmp")
        try:
            with temporary.open("x") as stream:
                stream.write(encode(document))
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(0o600)
            Settings.validate_file_values(read_config(temporary))
            if path.read_bytes() != original:
                raise ValueError("配置已并发变化，拒绝覆盖")
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    print("Website configuration validated and published; original key preserved")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--public", choices=["on", "off"])
    args = parser.parse_args()
    publish(args.snapshot, public_enabled=None if args.public is None else args.public == "on")


if __name__ == "__main__":
    main()
