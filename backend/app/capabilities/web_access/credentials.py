"""Native file-picker imports. No credential bytes cross the renderer boundary."""

import os
import plistlib
import re
import stat
import subprocess
from pathlib import Path
from uuid import uuid4

from app.capabilities.web_access.contracts import AccessConfigIn, GatewayProfile
from app.capabilities.web_access.profiles import AccessError


def import_file(store, source: Path, kind: str):
    source = source.absolute()
    if source.resolve() != source or source.is_symlink():
        raise AccessError("连接凭据不接受符号链接", 422)
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
            raise AccessError("连接凭据必须是小于 1 MiB 的普通文件", 422)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            content = stream.read(1024 * 1024 + 1)
    finally:
        os.close(fd)
    if kind == "known_hosts":
        try:
            rows = [
                line.split()
                for line in content.decode("utf-8").splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
            if not rows or len(rows) > 256:
                raise ValueError()
            for row in rows:
                if row[0].startswith("@"):
                    if row[0] not in {"@cert-authority", "@revoked"}:
                        raise ValueError()
                    row = row[1:]
                if len(row) < 3 or not row[1].startswith(("ssh-", "ecdsa-", "sk-")):
                    raise ValueError()
        except (ValueError, UnicodeError):
            raise AccessError("请选择包含已核验主机名和公钥的 known_hosts 文件", 422) from None
    store.credentials.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(store.credentials, 0o700)
    identity = uuid4().hex
    target = store.credential_path(identity, kind)
    handle = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(handle, "wb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    try:
        command = (
            ["/usr/bin/ssh-keygen", "-y", "-P", "", "-f", str(target)]
            if kind == "identity"
            else ["/usr/bin/ssh-keygen", "-l", "-f", str(target)]
        )
        result = subprocess.run(command, capture_output=True, timeout=5)
        if result.returncode:
            raise AccessError(
                "凭据格式无效；请选择可非交互使用的 SSH 密钥或已核验的 known_hosts", 422
            )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {"id": identity, "fingerprint": store.fingerprint(identity, kind)}


def adopt_legacy(store, session_id=None):
    try:
        plist = plistlib.loads(store.legacy_path().read_bytes())
        script = Path(plist["ProgramArguments"][1])
        text = script.read_text()
        if (
            script.name != "mac-reverse-tunnel.sh"
            or "com.futureprops.mac-host-tunnel" != plist["Label"]
        ):
            raise ValueError()
        user, host = re.findall(r"^\s*([a-zA-Z_][\w-]*)@([a-zA-Z0-9][\w.-]*)\s*$", text, re.M)[-1]
        source = script.parent.parent / ".local/mac-host/tunnel"
        identity = import_file(store, source / "id_ed25519", "identity")
        known = import_file(store, source / "known_hosts", "known_hosts")
        profile = GatewayProfile(
            origin=store.settings.fpl_remote_web_origin,
            local_port=store.settings.fpl_remote_web_port,
            host=host,
            user=user,
            identity_id=identity["id"],
            known_hosts_id=known["id"],
        )
        return store.prepare(
            AccessConfigIn(expected_revision=store.revision(), profile=profile),
            legacy=True,
            session_id=session_id,
        )
    except AccessError:
        raise
    except Exception:
        raise AccessError("无法读取现有隧道，请手动配置连接", 422) from None
