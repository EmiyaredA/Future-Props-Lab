"""Minimal, immutable projection of the installed Remote configuration."""

from dataclasses import dataclass
from urllib.parse import urlsplit

from studio.config import read_config


@dataclass(frozen=True)
class RemoteSettings:
    local_origin: str
    public_origin: str = ""
    host_label: str = "Mac"
    guacd_host: str = "guacd"
    fpl_cloud_control_guacd_port: int = 4822
    fpl_cloud_control_vnc_host: str = "host.docker.internal"
    fpl_cloud_control_vnc_port: int = 5900

    def __post_init__(self):
        local, public = urlsplit(self.local_origin), urlsplit(self.public_origin)
        if (
            local.scheme != "http"
            or local.hostname != "127.0.0.1"
            or not local.port
            or self.local_origin != f"http://{local.netloc}"
            or local.username is not None
            or (
                self.public_origin
                and (
                    public.scheme != "https"
                    or not public.hostname
                    or public.username is not None
                    or self.public_origin != f"https://{public.netloc}"
                )
            )
        ):
            raise ValueError("Remote 入口必须是精确的回环 HTTP 与公网 HTTPS 来源")
        if (
            self.guacd_host not in {"guacd", "127.0.0.1"}
            or self.fpl_cloud_control_vnc_host not in {"host.docker.internal", "127.0.0.1"}
            or not 1 <= self.fpl_cloud_control_guacd_port <= 65535
            or not 1 <= self.fpl_cloud_control_vnc_port <= 65535
            or not 1 <= len(self.host_label) <= 80
        ):
            raise ValueError("Remote 桌面目标配置无效")

    @classmethod
    def read(cls, path, *, guacd_host):
        fields = read_config(path)
        permitted = {
            "fpl_website_port",
            "fpl_remote_web_origin",
            "fpl_cloud_control_host_label",
            "fpl_cloud_control_guacd_port",
            "fpl_cloud_control_vnc_host",
            "fpl_cloud_control_vnc_port",
        }
        if fields.keys() - permitted:
            raise ValueError("Remote 配置包含其他服务字段")
        return cls(
            local_origin=f"http://127.0.0.1:{fields.get('fpl_website_port', 9001)}",
            public_origin=fields.get("fpl_remote_web_origin", ""),
            host_label=fields.get("fpl_cloud_control_host_label", "Mac"),
            guacd_host=guacd_host,
            fpl_cloud_control_guacd_port=fields.get("fpl_cloud_control_guacd_port", 4822),
            fpl_cloud_control_vnc_host=fields.get(
                "fpl_cloud_control_vnc_host", "host.docker.internal"
            ),
            fpl_cloud_control_vnc_port=fields.get("fpl_cloud_control_vnc_port", 5900),
        )
