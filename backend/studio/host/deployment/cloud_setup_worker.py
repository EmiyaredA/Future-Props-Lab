"""Mac-only cloud configuration coordinator with durable execution receipts."""

import argparse
import asyncio
import logging
import os
import stat
from pathlib import Path

import httpx
from fastapi import HTTPException

from app.console.cloud_control.schemas import CloudSetupUpdate
from app.console.cloud_control.setup import assert_setup_account, read_snapshot, setup_edit
from studio.apps.management.config_updates import config_bytes, replace_config
from studio.config import ConfigurationError
from studio.config.settings import Settings
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.remote_desktop.setup import OPERATIONS, READ, SAVE
from studio.host.cloud_projection import CloudPublisher
from studio.host.receipts import ReceiptStore
from studio.host.transport import LeaseEnded, NativeTransport, ProtocolConflict
from studio.runtime.lifecycle.locking import service_lock

logger = logging.getLogger(__name__)
ERRORS = {403: "setup_forbidden", 409: "configuration_conflict", 422: "invalid_setup"}


class CloudSetupWorker:
    def __init__(self, transport, config, projections, state_root):
        self.transport, self.config = transport, config
        self.publisher = CloudPublisher(projections)
        self.receipts = ReceiptStore(
            state_root / "receipts", readonly_operations={READ}, retain_acknowledged_payload=False
        )

    def synchronize(self):
        raw = config_bytes(self.config)
        self.publisher.synchronize(raw)

    async def authority(self, lease):
        result = await self.transport.post("authorize", {"lease": lease.model_dump(mode="json")})
        if result.get("active") is not True or type(result.get("enrolled")) is not bool:
            raise LeaseEnded("云控设置授权已失效")
        return result["enrolled"]

    async def execute(self, lease):
        if lease.operation not in OPERATIONS:
            raise ProtocolConflict("云控设置租约超出本机能力")
        if lease.operation == READ and lease.payload:
            raise ProtocolConflict("云控设置读取不得携带修改参数")
        try:
            enrolled = await self.authority(lease)
            owner = lease.owner_user_id
            settings = Settings(_config_file=self.config, _read_environment=False)
            assert_setup_account(settings, owner)
            if lease.operation == SAVE:
                body = CloudSetupUpdate.model_validate(lease.payload)
                self.require_factor(body, enrolled)
                await self.save(lease, owner, body)
                await asyncio.to_thread(self.synchronize)
            raw = config_bytes(self.config)
            settings = Settings(_config_file=self.config, _read_environment=False)
            result = await read_snapshot(self.config, raw, settings, enrolled)
            return NativeOutcome(status="completed", result=result.model_dump(mode="json"))
        except LeaseEnded:
            return NativeOutcome(
                status="failed", error_code="authorization_revoked", message="云控设置授权已失效"
            )
        except HTTPException as exc:
            if exc.status_code not in ERRORS:
                raise
            return NativeOutcome(
                status="failed", error_code=ERRORS[exc.status_code], message=str(exc.detail)
            )

    @staticmethod
    def require_factor(body, enrolled):
        if body.public_enabled and not enrolled:
            raise HTTPException(409, "请先在本机登记验证器")

    async def save(self, lease, owner, body):
        edit = setup_edit(owner, body)
        loop = asyncio.get_running_loop()

        def update(document):
            # The CAS lock is held here; confirm the exact browser request just
            # before applying the authorized fields.
            confirmed = asyncio.run_coroutine_threadsafe(self.authority(lease), loop).result(5)
            self.require_factor(body, confirmed)
            edit(document)

        await asyncio.to_thread(replace_config, self.config, body.revision, update)

    async def deliver(self, lease, outcome):
        result = await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if result.get("acknowledged") is not True:
            raise ProtocolConflict("云控设置回执未确认")
        await asyncio.to_thread(self.receipts.acknowledge, lease)

    async def poll_once(self):
        await asyncio.to_thread(self.synchronize)
        for lease, stored in self.receipts.pending():
            outcome = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await self.receipts.execute_async(lease, self.execute)
            )
            await self.deliver(lease, outcome)
        claim = await self.transport.post("claim", {"wait_seconds": 1})
        if claim.get("lease") is not None:
            lease = NativeLease.model_validate(claim["lease"])
            await self.deliver(lease, await self.receipts.execute_async(lease, self.execute))

    async def run(self):
        try:
            while True:
                try:
                    await self.poll_once()
                except (httpx.HTTPError, OSError, ConfigurationError, HTTPException):
                    logger.warning("云控配置或 Mac 连接暂不可用，保留原回执")
                    await asyncio.sleep(2)
                except (LeaseEnded, ProtocolConflict):
                    logger.warning("云控设置通道未确认，保留原回执")
                    await asyncio.sleep(5)
        finally:
            await self.transport.close()


def protected(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("云控配置和 worker 凭据须为当前用户私有文件")
    return path.resolve(strict=True)


def main():
    parser = argparse.ArgumentParser(description="FPL Mac cloud settings worker")
    parser.add_argument("--bridge", required=True)
    parser.add_argument("--worker-token", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--projections", required=True, type=Path)
    args = parser.parse_args()
    try:
        config = protected(args.config)
        credential = protected(args.worker_token).read_text().strip()
        transport = NativeTransport(service="remote", base_url=args.bridge, credential=credential)
        with service_lock(args.state_root):
            worker = CloudSetupWorker(transport, config, args.projections, args.state_root)
            asyncio.run(worker.run())
    except (ValueError, OSError):
        parser.error("云控 worker 的配置、目录或回环通道无效")


if __name__ == "__main__":
    main()
