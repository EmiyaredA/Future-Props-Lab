"""One application, one database lifecycle; an optional browser listener and SSH child."""

import asyncio
import contextlib
import json
import socket
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import uvicorn
from starlette.responses import PlainTextResponse

from app.capabilities.web_access.contracts import AccessStatus, EndpointStatus
from app.capabilities.web_access.profiles import AccessError, ProfileStore
from studio.runtime.http.remote_web import RemoteWeb
from studio.runtime.http.website import WebsiteStaticFiles


class BrowserServer(uvicorn.Server):
    @contextlib.contextmanager
    def capture_signals(self):
        # Only the main website server owns process signal handling.
        yield


class WebAccess:
    def __init__(self, app, settings, data_root, static_root, authenticate, *, shared_static=None):
        self.app = app
        self.store = ProfileStore(data_root, settings)
        self.profile = self.store.profile()
        self.static_root = static_root
        self.shared_static = shared_static
        self.authenticate = authenticate
        self.local = EndpointStatus(url=f"http://127.0.0.1:{self.profile.local_port}")
        self.public = EndpointStatus(url=self.profile.origin)
        self.lock = asyncio.Lock()
        self.server = None
        self.server_task = None
        self.sock = None
        self.tunnel_task = None
        self.child = None
        self.public_enabled = False
        self.instance = uuid4().hex
        self.bytes_received = self.bytes_sent = self.requests = 0

    def manifest(self):
        try:
            value = json.loads((self.static_root / "build.json").read_text())
            if not isinstance(value.get("build_id"), str) or not value["build_id"]:
                raise ValueError()
            return value
        except (OSError, ValueError):
            raise AccessError("缺少有效正式构建，请先构建并发布 Studio", 409) from None

    def status(self):
        try:
            build = self.manifest()["build_id"]
        except AccessError:
            build = ""
        return AccessStatus(
            local=self.local,
            public=self.public,
            build_id=build,
            bytes_received=self.bytes_received,
            bytes_sent=self.bytes_sent,
            requests=self.requests,
        )

    def accepts(self, scope):
        return self.sock is not None and scope.get("server") == (
            "127.0.0.1",
            self.profile.local_port,
        )

    async def __call__(self, app, scope, receive, send):
        if self.local.phase != "ready" or not self.public_enabled:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await PlainTextResponse("Public access is disabled", status_code=503)(
                    scope, receive, send
                )
            return
        ingress = RemoteWeb(
            origin=self.profile.origin,
            port=self.profile.local_port,
            static=self.shared_static or WebsiteStaticFiles(directory=self.static_root, html=True),
            authenticate=self.authenticate,
            secure_cookies=True,
        )
        self.requests += 1

        async def incoming():
            message = await receive()
            self.bytes_received += (
                len(message.get("body", b""))
                + len(message.get("bytes") or b"")
                + len((message.get("text") or "").encode())
            )
            return message

        async def outgoing(message):
            self.bytes_sent += (
                len(message.get("body", b""))
                + len(message.get("bytes") or b"")
                + len((message.get("text") or "").encode())
            )
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [
                        *message.get("headers", []),
                        (b"x-fpl-web-instance", self.instance.encode()),
                    ],
                }
            await send(message)

        await ingress(app, scope, incoming, outgoing)

    async def start_local(self):
        if self.server_task and not self.server_task.done():
            return
        if getattr(self.app.state, "storage_upgrade_required", False):
            raise AccessError("请先完成账号文件升级并重启应用")
        self.manifest()
        self.local.phase, self.local.error = "starting", ""
        sock = socket.socket()
        # A normal restart must not wait for recently closed tunnel connections
        # to leave TIME_WAIT. This does not allow two listening instances.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", self.profile.local_port))
            self.sock = sock
            self.server = BrowserServer(
                uvicorn.Config(
                    self.app,
                    lifespan="off",
                    access_log=False,
                    log_level="warning",
                    proxy_headers=False,
                    timeout_graceful_shutdown=5,
                )
            )
            self.server_task = asyncio.create_task(self.server.serve(sockets=[sock]))
            for _ in range(100):
                if self.server_task.done():
                    await self.server_task
                    raise AccessError("本地 Web 启动失败")
                if self.server.started:
                    self.local.phase = "ready"
                    return
                await asyncio.sleep(0.05)
            raise AccessError("本地 Web 启动超时")
        except Exception:
            sock.close()
            await self.stop_local()
            self.local.phase, self.local.error = "failed", "端口被占用或本地 Web 无法启动"
            raise AccessError(self.local.error) from None

    async def stop_public(self):
        self.public_enabled = False
        task, self.tunnel_task = self.tunnel_task, None
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self.stop_child()
        self.public.phase, self.public.error = "off", ""

    async def stop_child(self):
        child, self.child = self.child, None
        if child and child.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                child.terminate()
            try:
                await asyncio.wait_for(child.wait(), 5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    child.kill()
                await child.wait()

    async def stop_local(self):
        await self.stop_public()
        if self.server:
            self.server.should_exit = True
        task, self.server_task = self.server_task, None
        if task:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self.sock:
            self.sock.close()
        self.sock = self.server = None
        self.local.phase, self.local.error = "off", ""

    async def check_build(self):
        if not self.profile.origin:
            raise AccessError("请先配置公网连接", 422)
        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=8, follow_redirects=False
            ) as client:
                response = await client.get(self.profile.origin + "/build.json")
            if (
                response.status_code != 200
                or response.json().get("build_id") != self.manifest()["build_id"]
            ):
                raise ValueError()
        except Exception:
            raise AccessError("云端程序版本不匹配或不可达，请先发布匹配版本") from None

    def validate_credentials(self):
        p = self.profile
        if not p.host or not p.user or not p.origin:
            raise AccessError("请先完整配置公网网关", 422)
        for identity, kind in [(p.identity_id, "identity"), (p.known_hosts_id, "known_hosts")]:
            credential = self.store.credential_path(identity, kind)
            if not credential.is_file() or credential.is_symlink():
                raise AccessError("连接凭据缺失，请重新导入", 422)

    async def check_public(self):
        self.public.last_checked_at = datetime.now(UTC).isoformat()
        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=8, follow_redirects=False
            ) as client:
                response = await client.get(self.profile.origin + "/ready")
                if self.shared_static is not None:
                    build = await client.get(self.profile.origin + "/build.json")
                    if (
                        build.status_code != 200
                        or build.headers.get("x-fpl-web-instance") != self.instance
                        or build.json().get("build_id") != self.manifest()["build_id"]
                    ):
                        raise ValueError("公网构建与当前实例不一致")
            if (
                response.status_code != 200
                or response.headers.get("x-fpl-web-instance") != self.instance
            ):
                raise ValueError()
            self.public.phase, self.public.error = "ready", ""
        except Exception:
            self.public.phase, self.public.error = (
                "reconnecting",
                "公网就绪检查失败，等待下次检查",
            )
            raise AccessError(self.public.error) from None

    async def check_local(self):
        self.local.last_checked_at = datetime.now(UTC).isoformat()
        if not self.server_task:
            return
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=3) as client:
                response = await client.get(self.local.url + "/ready")
            if (
                response.status_code != 200
                or response.headers.get("x-fpl-web-instance") != self.instance
            ):
                raise ValueError()
            self.local.phase, self.local.error = "ready", ""
        except Exception:
            await self.stop_local()
            self.local.phase, self.local.error = "failed", "本地 Web 就绪检查失败，请停止后重新开启"
            raise AccessError(self.local.error) from None

    async def follow_tunnel(self):
        delay = 1
        try:
            while self.public_enabled:
                try:
                    p = self.profile
                    identity = self.store.credential_path(p.identity_id, "identity")
                    hosts = self.store.credential_path(p.known_hosts_id, "known_hosts")
                    if not identity.is_file() or not hosts.is_file() or not p.host or not p.user:
                        raise AccessError("连接凭据缺失，请检查网关配置", 422)
                    self.child = await asyncio.create_subprocess_exec(
                        "/usr/bin/ssh",
                        "-F",
                        "/dev/null",
                        "-N",
                        "-T",
                        "-S",
                        "none",
                        "-i",
                        str(identity),
                        "-p",
                        str(p.ssh_port),
                        "-o",
                        "IdentitiesOnly=yes",
                        "-o",
                        "BatchMode=yes",
                        "-o",
                        "StrictHostKeyChecking=yes",
                        "-o",
                        f"UserKnownHostsFile={json.dumps(str(hosts), ensure_ascii=False)}",
                        "-o",
                        "GlobalKnownHostsFile=/dev/null",
                        "-o",
                        "ExitOnForwardFailure=yes",
                        "-o",
                        "ConnectTimeout=8",
                        "-o",
                        "ServerAliveInterval=15",
                        "-o",
                        "ServerAliveCountMax=3",
                        "-R",
                        f"127.0.0.1:{p.remote_port}:127.0.0.1:{p.local_port}",
                        f"{p.user}@{p.host}",
                        stdin=asyncio.subprocess.DEVNULL,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    child = self.child
                    while self.public_enabled and child.returncode is None:
                        try:
                            await self.check_public()
                        except AccessError:
                            # An HTTP probe can fail during a release switch or gateway
                            # hiccup while SSH is still carrying established connections.
                            interval = 5
                        else:
                            delay = 1
                            interval = 30
                        with contextlib.suppress(TimeoutError):
                            await asyncio.wait_for(child.wait(), interval)
                    stderr = getattr(self.child, "stderr", None)
                    diagnostic = (await stderr.read(8192)) if stderr else b""
                    reason = next(
                        (
                            message
                            for marker, message in [
                                (
                                    b"Host key verification failed",
                                    "SSH 主机指纹不匹配，请核验并重新导入可信主机记录",
                                ),
                                (
                                    b"REMOTE HOST IDENTIFICATION HAS CHANGED",
                                    "SSH 主机指纹已改变，请核验并重新导入可信主机记录",
                                ),
                                (b"Permission denied", "SSH 专用密钥或账号未获授权"),
                                (
                                    b"remote port forwarding failed",
                                    "远端回环端口被占用或不允许转发",
                                ),
                            ]
                            if marker in diagnostic
                        ),
                        "",
                    )
                    if reason:
                        self.public_enabled = False
                        self.public.phase, self.public.error = "failed", reason
                        return
                    raise AccessError("SSH 连接已结束，请检查主机指纹、密钥和远端端口")
                except (AccessError, OSError):
                    self.public.phase, self.public.error = (
                        "reconnecting",
                        "SSH 或公网检查失败；请检查主机指纹、密钥、网络和端口",
                    )
                    await self.stop_child()
                    await asyncio.sleep(delay)
                    delay = min(30, delay * 2)
        finally:
            await self.stop_child()

    async def action(self, action):
        async with self.lock:
            if action == "local_start":
                await self.start_local()
            elif action == "local_stop":
                await self.stop_local()
            elif action == "public_stop":
                await self.stop_public()
            elif action == "public_start":
                if not self.public_enabled:
                    try:
                        self.validate_credentials()
                        if self.shared_static is None:
                            await self.check_build()
                    except AccessError as exc:
                        self.public.phase, self.public.error = "failed", str(exc)
                        raise
                    await self.start_local()
                    self.public_enabled = True
                    self.public.phase, self.public.error = "connecting", ""
                    self.tunnel_task = asyncio.create_task(self.follow_tunnel())
            elif action == "check":
                await self.check_local()
                if self.public_enabled:
                    await self.check_public()
            return self.status()

    async def close(self):
        async with self.lock:
            await self.stop_local()
