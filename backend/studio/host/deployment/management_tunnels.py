"""Dedicated SSH children for the two configured gateways; no inbound host server."""

import asyncio
import contextlib
import json
import os
import re
import stat
from urllib.parse import urlsplit

import httpx

from studio.contracts.gateway.web_access import GatewayProfile


class GatewayTunnel:
    def __init__(self, profile: GatewayProfile, credentials, *, service):
        self.profile, self.credentials, self.service = profile, credentials, service
        self.enabled = False
        self.task = None
        self.child = None
        self.phase, self.error, self.build_id = "off", "", ""

    def snapshot(self):
        origin = self.profile.origin
        if origin and self.service == "management":
            origin += "/management"
        return {
            "url": origin,
            "phase": self.phase,
            "error": self.error,
            "build_id": self.build_id,
        }

    def credential(self, identity, kind):
        if len(identity) != 32 or any(c not in "0123456789abcdef" for c in identity):
            raise ValueError("公网连接凭据未配置")
        path = self.credentials / f"{identity}.{kind}"
        if path.is_symlink() or not path.is_file():
            raise ValueError("公网连接凭据不可用")
        metadata = path.stat()
        if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise ValueError("公网连接凭据必须归当前用户所有且权限不超过 0600")
        return path

    async def check(self, *, remote=True):
        p = self.profile
        if not p.origin or not p.host or not p.user:
            raise ValueError("请先在配置中登记独立公网网关")
        self.credential(p.identity_id, "identity")
        self.credential(p.known_hosts_id, "known_hosts")
        probe = "/management/build.json" if self.service == "management" else "/build.json"
        async with httpx.AsyncClient(trust_env=False, timeout=5, follow_redirects=False) as client:
            local = await client.get(
                f"http://127.0.0.1:{p.local_port}{probe}",
                headers={"Host": urlsplit(p.origin).netloc},
            )
            local.raise_for_status()
            body = local.json()
            if body.get("service") != self.service or not re.fullmatch(
                r"[a-f0-9]{20}", str(body.get("build_id", ""))
            ):
                raise ValueError("本机网关构建标识无效")
            self.build_id = body["build_id"]
            if remote:
                public = await client.get(p.origin + probe)
                public.raise_for_status()
                other = public.json()
                if (other.get("service"), other.get("build_id")) != (self.service, self.build_id):
                    raise ValueError("公网与本机网关构建不一致")

    async def stop_child(self):
        child, self.child = self.child, None
        if child and child.returncode is None:
            child.terminate()
            try:
                await asyncio.wait_for(child.wait(), 5)
            except TimeoutError:
                child.kill()
                await child.wait()

    async def action(self, action):
        if action == "public_stop":
            self.enabled = False
            if self.task:
                self.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self.task
                self.task = None
            await self.stop_child()
            self.phase, self.error = "off", ""
        elif action == "public_start":
            if not self.enabled:
                await self.check(remote=False)
                self.enabled, self.phase, self.error = True, "connecting", ""
                self.task = asyncio.create_task(self.follow())
        elif action == "check":
            await self.check()
            if self.enabled:
                self.phase, self.error = "ready", ""
        else:
            raise ValueError("无效的公网操作")
        return self.snapshot()

    async def follow(self):
        delay = 1
        try:
            while self.enabled:
                try:
                    await self.check(remote=False)
                    p = self.profile
                    known_hosts = json.dumps(
                        str(self.credential(p.known_hosts_id, "known_hosts")), ensure_ascii=False
                    )
                    self.child = await asyncio.create_subprocess_exec(
                        "/usr/bin/ssh",
                        "-F",
                        "/dev/null",
                        "-N",
                        "-T",
                        "-S",
                        "none",
                        "-i",
                        str(self.credential(p.identity_id, "identity")),
                        "-p",
                        str(p.ssh_port),
                        "-o",
                        "IdentitiesOnly=yes",
                        "-o",
                        "IdentityAgent=none",
                        "-o",
                        "ForwardAgent=no",
                        "-o",
                        "BatchMode=yes",
                        "-o",
                        "StrictHostKeyChecking=yes",
                        "-o",
                        f"UserKnownHostsFile={known_hosts}",
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
                    await asyncio.sleep(1)
                    for _ in range(10):
                        if self.child.returncode is not None:
                            break
                        try:
                            await self.check()
                            break
                        except (ValueError, httpx.HTTPError):
                            await asyncio.sleep(1)
                    else:
                        raise ValueError("远端网关就绪超时")
                    while self.enabled and self.child.returncode is None:
                        await self.check()
                        self.phase, self.error, delay = "ready", "", 1
                        await asyncio.sleep(15)
                    diagnostic = await self.child.stderr.read(8192)
                    if any(
                        marker in diagnostic
                        for marker in (
                            b"Host key verification failed",
                            b"REMOTE HOST IDENTIFICATION HAS CHANGED",
                            b"Permission denied",
                            b"remote port forwarding failed",
                        )
                    ):
                        self.enabled = False
                        self.phase, self.error = (
                            "failed",
                            "SSH 凭据、可信指纹或远端转发授权无效，请本机核查",
                        )
                        return
                except (ValueError, OSError, httpx.HTTPError):
                    self.phase, self.error = "reconnecting", "公网或本机网关暂不可达，正在重连"
                await self.stop_child()
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)
        finally:
            await self.stop_child()

    async def close(self):
        await self.action("public_stop")
