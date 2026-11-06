"""Pull signaling work from Remote without exposing a listener on the Mac."""

import asyncio
import json
import logging
from contextlib import suppress

import httpx

from studio.config import ConfigurationError
from studio.config.settings import Settings
from studio.contracts.remote_desktop.apps import NativeAppLease
from studio.host.remote_apps.bridge import HostUnavailable, run_host
from studio.host.remote_apps.setup import allowed_ids, available
from studio.host.transport import LeaseEnded, ProtocolConflict

logger = logging.getLogger(__name__)


async def forward(transport, session, process):
    async def to_host():
        while True:
            message = (await transport.post(f"app-relay/{session}/command", {}))["message"]
            if message is not None:
                process.stdin.write(json.dumps(message, separators=(",", ":")).encode() + b"\n")
                await asyncio.wait_for(process.stdin.drain(), 3)

    async def to_remote():
        while line := await process.stdout.readline():
            await transport.post(f"app-relay/{session}/event", {"message": json.loads(line)})

    tasks = [asyncio.create_task(run()) for run in (to_host, to_remote)]
    try:
        completed, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in completed:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_app_relay(transport, config):
    while True:
        try:
            settings = Settings(_config_file=config, _read_environment=False)
            claim = await transport.post("app-relay/claim", {"available": available(settings)})
            if lease := claim["lease"]:
                lease = NativeAppLease.model_validate(lease)
                session, app = lease.session, lease.app_id
                try:
                    settings = Settings(_config_file=config, _read_environment=False)
                    if not available(settings) or app not in allowed_ids(settings):
                        raise HostUnavailable("应用授权已失效")
                    async with run_host(
                        settings.fpl_cloud_control_apps_host, "session", app
                    ) as process:
                        await forward(transport, session, process)
                finally:
                    with suppress(LeaseEnded, ProtocolConflict, httpx.HTTPError):
                        await transport.post(f"app-relay/{session}/event", {"message": None})
        except LeaseEnded:
            pass
        except (
            ConfigurationError,
            HostUnavailable,
            OSError,
            TimeoutError,
            ValueError,
            httpx.HTTPError,
            ProtocolConflict,
        ):
            logger.warning("Mac 远程应用信令连接暂不可用")
        await asyncio.sleep(1)
