"""Carry already-authorized client profiles forward through the website API."""

import argparse
import json
import os
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sdk/python/src"))


def main():
    from future_props_lab import ApiError
    from future_props_lab.website import connect_website, profile_path

    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:9000")
    args = parser.parse_args()
    directory = ROOT / ".runtime/agent"
    migrated = []
    reconnect = []
    for path in sorted(directory.glob("credentials-*.json")):
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError("原客户端凭据权限不安全，拒绝导入")
        profile = path.stem.removeprefix("credentials-")
        target = profile_path(profile=profile, profile_dir=directory)
        if target.exists():
            continue
        data = json.loads(path.read_text())
        try:
            result = connect_website(
                url=args.url, api_key=data["api_key"], profile=profile, profile_dir=directory
            )
        except ApiError as exc:
            if exc.status not in {401, 403}:
                raise
            reconnect.append(profile)
            continue
        if data.get("user_id") and result["user_id"] != data["user_id"]:
            target.unlink()
            raise ValueError("客户端账号与原授权不一致")
        migrated.append(profile)
    executable = Path.home() / ".local/bin/fpl"
    marker = "# Future Props Lab website CLI"
    body = (
        "#!/bin/sh\n"
        + marker
        + "\nexport FPL_PROFILE_DIR="
        + shlex.quote(str(directory))
        + "\nexec "
        + shlex.quote(str(ROOT / ".venv/bin/fpl"))
        + ' "$@"\n'
    )
    if executable.exists() or executable.is_symlink():
        if executable.is_symlink() or marker not in executable.read_text():
            raise ValueError("已有其他 fpl 命令，未覆盖；可直接使用项目 .venv/bin/fpl")
    executable.parent.mkdir(parents=True, exist_ok=True)
    temporary = executable.with_name(".fpl-website.tmp")
    with temporary.open("x") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.chmod(0o700)
    os.replace(temporary, executable)
    print(
        json.dumps(
            {
                "profiles_migrated": migrated,
                "requires_reauthorization": reconnect,
                "command": str(executable),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
