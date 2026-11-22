"""Exercise the real development front door without touching deployed services."""

import asyncio
import contextlib
import json
import os
import re
import shutil
import socket
import subprocess
from pathlib import Path

import httpx
import pytest
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from websockets.asyncio.client import connect

from studio.contracts.gateway.catalog import SERVICES
from studio.contracts.gateway.routing import Operation, RouteCatalog
from studio.deployment.gateway import render_gateway

ROOT = Path(__file__).resolve().parents[2]


class Server(uvicorn.Server):
    @contextlib.contextmanager
    def capture_signals(self):
        yield


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.mark.asyncio
async def test_public_proxy_serves_vite_hmr_and_preserves_public_authorization(tmp_path):
    caddy = shutil.which("caddy") or str(ROOT / ".runtime/native-development/tools/caddy")
    if not Path(caddy).is_file() or not shutil.which("node"):
        pytest.skip("Caddy and Node are required for the development proxy integration test")
    # Select distinct unprivileged ports without using deployed listeners.
    ports = set()
    while len(ports) < 4:
        ports.add(free_port())
    api_port, vite_port, local_port, public_port = ports
    origin = f"https://studio.example.test:{public_port}"
    observed = []

    async def authorize(request):
        observed.append(dict(request.headers))
        if request.headers.get("cookie") != "session=isolated-test":
            return Response(status_code=401)
        return Response(headers={"X-Fpl-Context": request.headers["x-fpl-ingress"]})

    async def business(request):
        return JSONResponse(dict(request.headers))

    app = Starlette(
        routes=[
            Route("/_internal/v1/authorize", authorize),
            Route("/v1/files", business, methods=["POST"]),
        ]
    )
    api_socket = socket.socket()
    api_socket.bind(("127.0.0.1", api_port))
    api = Server(uvicorn.Config(app, log_level="error", lifespan="off"))
    api_task = asyncio.create_task(api.serve(sockets=[api_socket]))
    pages = tmp_path / "web.json"
    pages.write_text(
        json.dumps(
            [
                {
                    "service": "portal",
                    "roots": ["/", "/login"],
                    "build": "test",
                    "entry": "portal.html",
                }
            ]
        )
    )
    script = """
      import { createServer } from 'vite';
      const server = await createServer({
        configFile: process.env.TEST_NATIVE_CONFIG,
        root: process.env.TEST_WEB_ROOT,
        server: {port: Number(process.env.TEST_VITE_PORT), watch: {ignored: ['**/*']}},
        optimizeDeps: {noDiscovery: true, include: [], entries: []}
      });
      await server.listen();
    """
    environment = {key: value for key, value in os.environ.items() if not key.startswith("FPL_")}
    environment.update(
        FPL_NATIVE_WEB_CONFIG=str(pages),
        FPL_NATIVE_PUBLIC_ORIGINS=json.dumps([origin]),
        FPL_VITE_CACHE_DIR=str(tmp_path / "vite-cache"),
        TEST_NATIVE_CONFIG=str(ROOT / "web/native.config.ts"),
        TEST_WEB_ROOT=str(ROOT / "web"),
        TEST_VITE_PORT=str(vite_port),
        XDG_CONFIG_HOME=str(tmp_path / "config"),
        XDG_DATA_HOME=str(tmp_path / "data"),
    )
    addresses = {unit.id: f"127.0.0.1:{api_port}" for unit in SERVICES}
    config = tmp_path / "Caddyfile"
    config.write_text(
        render_gateway(
            RouteCatalog([Operation("assets", "POST", "/v1/files", "upload")]),
            gateway_token="g" * 40,
            local_origin="http://127.0.0.1:3000",
            public_origin=origin,
            addresses=addresses,
            local_only=True,
            local_port=local_port,
            public_loopback_port=public_port,
            development_frontend=f"127.0.0.1:{vite_port}",
        )
    )
    processes = []
    log = (tmp_path / "proxy.log").open("w")
    try:
        processes.append(
            subprocess.Popen(
                ["node", "--input-type=module", "-e", script],
                cwd=ROOT,
                env=environment,
                stdout=log,
                stderr=log,
            )
        )
        processes.append(
            subprocess.Popen(
                [caddy, "run", "--config", str(config), "--adapter", "caddyfile"],
                env=environment,
                stdout=log,
                stderr=log,
            )
        )
        headers = {"Host": f"studio.example.test:{public_port}", "Origin": origin}
        base = f"http://127.0.0.1:{public_port}"
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            for _ in range(200):
                if any(process.poll() is not None for process in processes):
                    pytest.fail((tmp_path / "proxy.log").read_text())
                try:
                    response = await client.get(base + "/@vite/client", headers=headers)
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.1)
            else:
                pytest.fail((tmp_path / "proxy.log").read_text())
            vite_client = response.text
            page = await client.get(base + "/login", headers={**headers, "Accept": "text/html"})
            assert page.status_code == 200, page.text
            assert "__FPL_NATIVE__" in page.text and "/@vite/client" in page.text
            assert page.headers["cache-control"] == "no-store"
            for path in ("/_internal/secret", "/_native/secret", "/_bridge/secret", "/v1/missing"):
                assert (await client.get(base + path, headers=headers)).status_code == 404
            for forged in (
                {**headers, "Host": "wrong.example.test"},
                {**headers, "Origin": "https://wrong.example.test"},
            ):
                assert (await client.get(base + "/login", headers=forged)).status_code == 403
            response = await client.post(base + "/v1/files", headers=headers)
            assert response.status_code == 401
            response = await client.post(
                base + "/v1/files",
                headers={
                    **headers,
                    "Cookie": "session=isolated-test",
                    "X-Fpl-Ingress": "local",
                    "X-Fpl-Context": "forged",
                    "X-Forwarded-Host": "127.0.0.1:3000",
                },
            )
            assert response.status_code == 200, response.text
            assert observed[-1]["x-fpl-ingress"] == "public"
            assert "x-fpl-context" not in observed[-1]
            assert response.json()["x-fpl-context"] == "public"
            assert "cookie" not in response.json()
            local = await client.post(
                f"http://127.0.0.1:{local_port}/v1/files",
                headers={"Host": "127.0.0.1:3000", "Cookie": "session=isolated-test"},
            )
            assert local.status_code == 200
            assert local.json()["x-fpl-context"] == "local"
            (tmp_path / "private.key").write_text("isolated-secret-must-not-be-served")
            assert (
                await client.get(base + "/@fs/" + str(tmp_path / "private.key"), headers=headers)
            ).status_code == 403
            token = re.search(r'const wsToken = "([^"]+)"', vite_client)
            assert token, "Vite HMR token was not emitted"
            async with connect(
                f"ws://studio.example.test:{public_port}/?token={token[1]}",
                host="127.0.0.1",
                port=public_port,
                origin=origin,
                subprotocols=["vite-hmr"],
                proxy=None,
            ) as websocket:
                assert (
                    json.loads(await asyncio.wait_for(websocket.recv(), 5))["type"] == "connected"
                )
    finally:
        for process in reversed(processes):
            process.terminate()
        for process in reversed(processes):
            try:
                await asyncio.to_thread(process.wait, 10)
            except subprocess.TimeoutExpired:
                process.kill()
                await asyncio.to_thread(process.wait)
        log.close()
        api.should_exit = True
        await asyncio.wait_for(api_task, 5)
