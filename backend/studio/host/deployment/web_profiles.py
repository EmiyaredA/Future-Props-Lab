"""Read-only gateway profile and explicit credential paths."""

from pathlib import Path

from studio.contracts.gateway.web_access import AccessError, GatewayProfile


class ProfileStore:
    def __init__(self, data_root: Path, settings):
        self.root = data_root
        self.settings = settings

    @property
    def credentials(self):
        return self.root / "backend/web-access/credentials"

    def credential_path(self, identity: str, kind: str):
        if len(identity) != 32 or any(c not in "0123456789abcdef" for c in identity):
            raise AccessError("请先导入连接凭据", 422)
        return self.credentials / f"{identity}.{kind}"

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
