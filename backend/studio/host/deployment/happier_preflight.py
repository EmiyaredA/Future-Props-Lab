"""Check the local Happier projection before stopping or starting business services."""

import ssl
from urllib.parse import urlsplit

from studio.config import read_config

PROJECTED = ("origin", "studio_origin", "admin_user_id", "relay_port", "listen_port")


def check_happier_deployment(values, control):
    studio_origin = values.get("fpl_happier_studio_origin")
    if not studio_origin:
        raise ValueError("独立网关仅支持本机 HTTPS Happier")
    origin = values["fpl_happier_origin"]
    env = control.env
    expected = {
        "FPL_HAPPIER_STUDIO_PORT": str(urlsplit(studio_origin).port),
        "FPL_HAPPIER_BROWSER_PORT": str(urlsplit(origin).port),
        "FPL_HAPPIER_CERT_FILE": values.get("fpl_happier_tls_certfile"),
        "FPL_HAPPIER_KEY_FILE": values.get("fpl_happier_tls_keyfile"),
    }
    if any(not value or env.get(key) != value for key, value in expected.items()):
        raise ValueError("本机 Happier 的 Compose 端口或 TLS 文件与正式配置不一致")
    for name in ("FPL_IDENTITY_CONFIG", "FPL_GATEWAY_SETTINGS"):
        path = control.project_directory / env.get(name, "")
        if not path.is_file():
            raise ValueError(f"本机 Happier 缺少服务配置 {name}")
        projection = read_config(path)
        if any(
            projection.get(f"fpl_happier_{key}") != values.get(f"fpl_happier_{key}")
            for key in PROJECTED
        ):
            raise ValueError(f"本机 Happier 配置与 {name} 不一致")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        context.load_cert_chain(expected["FPL_HAPPIER_CERT_FILE"], expected["FPL_HAPPIER_KEY_FILE"])
    except (OSError, ValueError):
        raise ValueError("本机 Happier TLS 证书或私钥不可用") from None
