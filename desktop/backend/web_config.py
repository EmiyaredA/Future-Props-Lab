"""Publish an authorized connection profile while the desktop data lease is held."""

import hashlib
import json
import os
import plistlib
import subprocess
import tempfile
import tomllib
from pathlib import Path

from development_data import check_data, offline_backup

from app.capabilities.web_access.contracts import GatewayProfile
from app.runtime.config import Settings
from fpl_config import flatten
from fpl_config.migration import encode


def apply_profile(root: Path, payload: dict) -> None:
    config = root / "backend/config.toml"
    original = config.read_bytes()
    if hashlib.sha256(original).hexdigest() != payload["expected_revision"]:
        raise ValueError("连接配置已改变，未应用；请重新读取")
    profile = GatewayProfile.model_validate(payload["profile"])
    document = tomllib.loads(original.decode())
    remote = document.setdefault("remote_web", {})
    remote.update(
        origin=profile.origin,
        port=profile.local_port,
        enabled=False,
        ssh_host=profile.host,
        ssh_user=profile.user,
        ssh_port=profile.ssh_port,
        remote_port=profile.remote_port,
        identity_id=profile.identity_id,
        known_hosts_id=profile.known_hosts_id,
    )
    Settings.validate_file_values(flatten(document))
    check_data(root)
    backup = offline_backup(root)
    if config.read_bytes() != original:
        raise ValueError("备份期间配置发生改变，未应用；请重新读取")
    if payload.get("adopt_legacy"):
        disable_legacy(backup)
    fd, temporary = tempfile.mkstemp(prefix=".web-config-", dir=config.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(encode(document))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, config)
        directory = os.open(config.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def disable_legacy(backup: Path) -> None:
    label = "com.futureprops.mac-host-tunnel"
    source = Path.home() / f"Library/LaunchAgents/{label}.plist"
    value = plistlib.loads(source.read_bytes())
    if value.get("Label") != label or source.is_symlink():
        raise ValueError("旧隧道配置无法安全接管")
    recovery = backup / "legacy-tunnel.plist"
    recovery.write_bytes(source.read_bytes())
    recovery.chmod(0o600)
    target = f"gui/{os.getuid()}/{label}"
    result = subprocess.run(["/bin/launchctl", "disable", target], capture_output=True)
    if result.returncode:
        raise ValueError("无法停用旧隧道的自动启动，未应用连接配置")
    subprocess.run(["/bin/launchctl", "bootout", target], capture_output=True)
    probe = subprocess.run(["/bin/launchctl", "print", target], capture_output=True)
    if probe.returncode == 0:
        raise ValueError("旧隧道仍在运行，未应用连接配置")
    (backup / "legacy-tunnel-recovery.json").write_text(
        json.dumps(
            {
                "label": label,
                "plist": str(source),
                "disabled": True,
                "restore": [
                    "launchctl enable " + target,
                    "launchctl bootstrap gui/" + str(os.getuid()) + " " + str(source),
                ],
            },
            ensure_ascii=False,
        )
        + "\n"
    )
