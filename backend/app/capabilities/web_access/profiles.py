"""Read-only profile views and short-lived, one-use native-host authorizations."""

import hashlib
import re
import secrets
import subprocess
import time
from pathlib import Path

from app.capabilities.web_access.contracts import AccessConfigOut, GatewayProfile


class AccessError(Exception):
    def __init__(self, message: str, status=409):
        super().__init__(message)
        self.status = status


class ProfileStore:
    def __init__(self, data_root: Path, settings):
        self.root = data_root
        self.settings = settings
        self.pending = {}

    @property
    def config_path(self):
        return self.root / "backend/config.toml"

    @property
    def credentials(self):
        return self.root / "backend/web-access/credentials"

    def credential_path(self, identity: str, kind: str):
        if len(identity) != 32 or any(c not in "0123456789abcdef" for c in identity):
            raise AccessError("请先导入连接凭据", 422)
        return self.credentials / f"{identity}.{kind}"

    def revision(self):
        return hashlib.sha256(self.config_path.read_bytes()).hexdigest()

    def profile(self):
        s = self.settings
        return GatewayProfile(
            origin=s.fpl_remote_web_origin,
            local_port=s.fpl_remote_web_port,
            host=s.fpl_remote_web_ssh_host,
            ssh_port=s.fpl_remote_web_ssh_port,
            user=s.fpl_remote_web_ssh_user,
            remote_port=s.fpl_remote_web_remote_port,
            identity_id=s.fpl_remote_web_identity_id,
            known_hosts_id=s.fpl_remote_web_known_hosts_id,
        )

    def fingerprint(self, identity, kind):
        if not identity:
            return ""
        path = self.credential_path(identity, kind)
        if not path.is_file() or path.is_symlink():
            return "文件缺失"
        result = subprocess.run(
            ["/usr/bin/ssh-keygen", "-l", "-E", "sha256", "-f", str(path)],
            capture_output=True,
            timeout=5,
        )
        fingerprints = [
            fields[1]
            for line in result.stdout.splitlines()
            if len(fields := line.split()) >= 2
            and re.fullmatch(rb"SHA256:[A-Za-z0-9+/]+", fields[1])
        ]
        return ", ".join(dict.fromkeys(item.decode("ascii") for item in fingerprints)) or "格式无效"

    def view(self):
        profile = self.profile()
        return AccessConfigOut(
            revision=self.revision(),
            profile=profile,
            identity_fingerprint=self.fingerprint(profile.identity_id, "identity"),
            known_hosts_fingerprint=self.fingerprint(profile.known_hosts_id, "known_hosts"),
            legacy_available=self.legacy_path().is_file(),
        )

    @staticmethod
    def legacy_path():
        return Path.home() / "Library/LaunchAgents/com.futureprops.mac-host-tunnel.plist"

    def ticket(self, kind: str, value):
        now = time.monotonic()
        self.pending = {key: row for key, row in self.pending.items() if row[0] > now}
        if len(self.pending) >= 16:
            raise AccessError("待处理操作过多，请稍后重试")
        token = secrets.token_urlsafe(32)
        self.pending[token] = (now + 180, kind, value)
        return token

    def claim(self, token, kind):
        row = self.pending.pop(token, None)
        if not row or row[0] < time.monotonic() or row[1] != kind:
            raise AccessError("操作已过期，请重新开始", 403)
        return row[2]

    def prepare(self, body, *, legacy=False, session_id=None):
        if body.expected_revision != self.revision():
            raise AccessError("连接配置已改变，请重新读取", 409)
        p = body.profile
        if p.host and not all([p.user, p.origin, p.identity_id, p.known_hosts_id]):
            raise AccessError("请完整配置域名、SSH 账号和连接凭据", 422)
        for identity, kind in [(p.identity_id, "identity"), (p.known_hosts_id, "known_hosts")]:
            if identity and not self.credential_path(identity, kind).is_file():
                raise AccessError("连接凭据不存在，请重新导入", 422)
        return self.ticket(
            "config",
            {
                "expected_revision": body.expected_revision,
                "profile": p.model_dump(),
                "adopt_legacy": legacy,
                "session_id": session_id,
            },
        )
