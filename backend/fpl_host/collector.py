"""Native collector coordinator: bounded reads, durable receipts, outbound connections only."""

import asyncio
import logging

import httpx

from fpl_runtime.native_protocol import NativeLease, NativeOutcome

from .agent_sources import OPERATIONS, execute
from .follow import SourceFollow
from .follow_journal import FollowJournal
from .receipts import ReceiptStore
from .transport import LeaseEnded, ProtocolConflict

logger = logging.getLogger(__name__)


class Collector:
    def __init__(self, transport, state_root, *, max_follows=16):
        self.transport = transport
        self.receipts = ReceiptStore(state_root / "receipts", readonly_operations=OPERATIONS)
        self.journal = FollowJournal(state_root / "follow")
        self.limit = max_follows
        self.follows = {}
        self.blocked = set()

    async def deliver(self, lease, outcome):
        await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        self.receipts.acknowledge(lease)

    async def oneshot(self, lease):
        outcome = await asyncio.to_thread(self.receipts.execute, lease, execute)
        await self.deliver(lease, outcome)

    def start_follow(self, lease):
        key = str(lease.job_id)
        if key not in self.follows and key not in self.blocked:
            self.journal.read(lease)
            self.follows[key] = asyncio.create_task(self.follow(lease))

    async def follow(self, lease):
        while True:
            try:
                await SourceFollow(self.transport, self.journal, lease).run()
                return
            except (httpx.HTTPError, OSError):
                await asyncio.sleep(3)
            except ProtocolConflict:
                self.blocked.add(str(lease.job_id))
                return
            except (ValueError, KeyError, TypeError):
                # A deterministic read failure can be retried by a new source task.
                outcome = NativeOutcome(
                    status="failed",
                    error_code="native_source_unavailable",
                    message="原生来源暂不可读；原始文件未修改",
                )
                try:
                    await self.transport.post(
                        "receipt",
                        {
                            "lease": lease.model_dump(mode="json"),
                            "outcome": outcome.model_dump(mode="json"),
                        },
                    )
                except LeaseEnded:
                    pass
                self.journal.end(lease)
                return
            except LeaseEnded:
                self.journal.end(lease)
                return

    async def run(self):
        try:
            for lease in self.journal.recover():
                if len(self.follows) >= self.limit:
                    raise ValueError("恢复跟随任务超过并发限制")
                self.start_follow(lease)
            while True:
                try:
                    for lease, stored in self.receipts.pending():
                        outcome = (
                            NativeOutcome.model_validate(stored)
                            if stored is not None
                            else await asyncio.to_thread(self.receipts.execute, lease, execute)
                        )
                        await self.deliver(lease, outcome)
                    for key, task in list(self.follows.items()):
                        if task.done():
                            task.result()
                            del self.follows[key]
                    allowed = sorted(
                        OPERATIONS
                        | ({"agent_sources.follow"} if len(self.follows) < self.limit else set())
                    )
                    response = await self.transport.post(
                        "claim", {"wait_seconds": 20, "operations": allowed}
                    )
                    if response["lease"]:
                        lease = NativeLease.model_validate(response["lease"])
                        if lease.operation == "agent_sources.follow":
                            self.start_follow(lease)
                        else:
                            await self.oneshot(lease)
                except (httpx.HTTPError, OSError):
                    await asyncio.sleep(3)
                except (LeaseEnded, ProtocolConflict):
                    logger.error(
                        "Native worker authorization or receipt rejected; waiting for review"
                    )
                    await asyncio.sleep(10)
        finally:
            for task in self.follows.values():
                task.cancel()
            await asyncio.gather(*self.follows.values(), return_exceptions=True)
            await self.transport.close()
