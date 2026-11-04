"""Mac-side fixed CLI discovery and trusted local connection enablement."""

import argparse
import asyncio
import logging
import os
import stat
from pathlib import Path

import httpx
from fastapi import HTTPException

from fpl_runtime.agent_connections import (
    ENABLE,
    OPERATIONS,
    READ_OPERATIONS,
    CatalogRequest,
    EnableRequest,
    EnableResult,
)
from fpl_runtime.locking import service_lock
from fpl_runtime.native_protocol import NativeLease, NativeOutcome

from .receipts import ReceiptStore
from .transport import LeaseEnded, NativeTransport, ProtocolConflict

logger = logging.getLogger(__name__)


class ConnectionWorker:
    def __init__(self, transport, state_root, *, catalog, enable):
        self.transport = transport
        self.catalog, self.enable = catalog, enable
        self.receipts = ReceiptStore(
            state_root / "receipts",
            readonly_operations=READ_OPERATIONS,
            retain_acknowledged_payload=False,
        )

    async def authorize(self, lease):
        result = await self.transport.post("authorize", {"lease": lease.model_dump(mode="json")})
        if result.get("active") is not True:
            raise LeaseEnded("CLI 任务授权已撤销")

    async def execute(self, lease):
        if lease.operation not in OPERATIONS:
            raise ProtocolConflict("CLI 租约超出原生能力")
        if lease.operation == ENABLE:
            EnableRequest.model_validate(lease.payload)
        else:
            CatalogRequest.model_validate(lease.payload)
        try:
            await self.authorize(lease)
        except LeaseEnded:
            return await asyncio.to_thread(
                self.receipts.execute, lease, lambda *_: {"error": "authorization_revoked"}
            )
        loop = asyncio.get_running_loop()

        async def before_publish():
            check = asyncio.run_coroutine_threadsafe(self.authorize(lease), loop)
            await asyncio.wrap_future(check)

        async def action(operation, payload):
            if operation in READ_OPERATIONS:
                query = CatalogRequest.model_validate(payload)
                return (await self.catalog(can_enable=query.show_paths)).model_dump()
            agent = EnableRequest.model_validate(payload).agent_id
            try:
                await self.enable(agent, before_publish=before_publish)
            except LeaseEnded:
                return {"error": "authorization_revoked"}
            except HTTPException as exc:
                if exc.status_code == 409:
                    return {"error": "connection_unavailable"}
                raise
            return EnableResult(enabled=True).model_dump()

        def invoke(operation, payload):
            return asyncio.run(action(operation, payload))

        return await asyncio.to_thread(self.receipts.execute, lease, invoke)

    async def deliver(self, lease, result):
        if result.status == "completed" and result.result.get("error") in {
            "authorization_revoked",
            "connection_unavailable",
        }:
            result = NativeOutcome(status="failed", error_code=result.result["error"])
        response = await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": result.model_dump(mode="json")},
        )
        if response.get("acknowledged") is not True:
            raise ProtocolConflict("CLI 任务回执未确认")
        self.receipts.acknowledge(lease)

    async def poll_once(self):
        for lease, stored in self.receipts.pending():
            result = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await asyncio.to_thread(self.receipts.execute, lease, lambda *_: None)
            )
            await self.deliver(lease, result)
        claim = await self.transport.post("claim", {"wait_seconds": 1})
        if claim.get("lease") is not None:
            lease = NativeLease.model_validate(claim["lease"])
            await self.deliver(lease, await self.execute(lease))

    async def run(self):
        try:
            while True:
                try:
                    await self.poll_once()
                except (httpx.HTTPError, OSError):
                    await asyncio.sleep(1)
                except (LeaseEnded, ProtocolConflict):
                    logger.warning("Agent Runtime worker 凭据或回执未确认")
                    await asyncio.sleep(3)
        finally:
            await self.transport.close()


async def serve(args, credential):
    from app.console.governance.code_agent_connections import enable_connection
    from app.console.governance.code_agents import catalog

    transport = NativeTransport(
        base_url=args.bridge, credential=credential, service="agent-runtime"
    )
    worker = ConnectionWorker(transport, args.state_root, catalog=catalog, enable=enable_connection)
    await worker.run()


def main():
    parser = argparse.ArgumentParser(description="FPL Mac Agent Runtime connection worker")
    parser.add_argument("--bridge", required=True)
    parser.add_argument("--worker-token", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    try:
        for path in (args.worker_token, args.config):
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError
        credential = args.worker_token.read_text().strip()
    except (OSError, ValueError):
        parser.error("CLI 配置和 worker 凭据须为当前用户独占的普通文件")
    os.environ["FPL_CONFIG_FILE"] = str(args.config.resolve())
    with service_lock(args.state_root):
        asyncio.run(serve(args, credential))


if __name__ == "__main__":
    main()
