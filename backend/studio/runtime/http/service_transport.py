"""Explicit connection routing for independently authenticated local services."""

import re

import httpx


class LocalServiceTransport(httpx.AsyncBaseTransport):
    """Keep logical service URLs/signatures while connecting over loopback TCP."""

    def __init__(self, addresses, *, transport=None):
        if not addresses or any(
            not re.fullmatch(r"[a-z][a-z0-9-]*", name)
            or not re.fullmatch(r"127\.0\.0\.1:[0-9]{4,5}", address)
            or not 1024 <= int(address.rsplit(":", 1)[1]) <= 65535
            for name, address in addresses.items()
        ):
            raise ValueError("本机服务连接必须是明确的回环地址")
        self.addresses = dict(addresses)
        self.transport = transport or httpx.AsyncHTTPTransport(trust_env=False)

    async def handle_async_request(self, request):
        address = self.addresses.get(request.url.host)
        if address is not None:
            if request.url.scheme != "http" or request.url.port != 8080:
                raise httpx.ConnectError("服务连接协议或端口不匹配", request=request)
            host, port = address.split(":")
            forwarded = httpx.Request(
                request.method,
                request.url.copy_with(host=host, port=int(port)),
                headers=request.headers,
                stream=request.stream,
                extensions=request.extensions,
            )
        else:
            forwarded = request
        return await self.transport.handle_async_request(forwarded)

    async def aclose(self):
        await self.transport.aclose()
