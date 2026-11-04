"""Authenticated outbound loopback RPC; never follow redirects or proxy environment."""

import re
from urllib.parse import urlsplit

import httpx


class LeaseEnded(RuntimeError):
    pass


class ProtocolConflict(RuntimeError):
    pass


class NativeTransport:
    def __init__(self, *, base_url, credential, transport=None, service="agents"):
        if service not in {"agents", "management", "models", "integrations", "tools"}:
            raise ValueError("未登记的原生通道")
        url = urlsplit(base_url)
        if (
            url.scheme != "http"
            or url.hostname not in {"127.0.0.1", "::1"}
            or not url.port
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path != "/" + service
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", credential)
        ):
            raise ValueError("原生采集只能连接指定的受认证回环入口")
        self.client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            trust_env=False,
            follow_redirects=False,
            timeout=httpx.Timeout(30, read=35),
            headers={"Authorization": "Bearer " + credential},
            transport=transport,
        )

    async def post(self, operation, body):
        response = await self.client.post("_native/v1/" + operation, json=body)
        if response.status_code in {403, 410}:
            raise LeaseEnded("原生任务授权已结束")
        if response.status_code in {409, 422}:
            raise ProtocolConflict("原生协议或回执冲突；保留本机回执等待核对")
        response.raise_for_status()
        return response.json()

    async def close(self):
        await self.client.aclose()
