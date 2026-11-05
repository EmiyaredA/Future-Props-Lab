"""Checkpointed, read-only native follow. Storage authority remains in the Agents service."""

import asyncio
import logging
import time
from dataclasses import asdict

import httpx
from watchfiles import awatch

from app.capabilities.agents.sessions.catalog import get_adapter
from app.capabilities.agents.sessions.locations import validate_location

from .transport import LeaseEnded, ProtocolConflict

logger = logging.getLogger(__name__)


class SourceFollow:
    def __init__(self, transport, journal, lease, *, poll_seconds=3, files_per_pass=100):
        if lease.operation != "agent_sources.follow":
            raise ValueError("不是原生跟随任务")
        self.transport, self.journal, self.lease = transport, journal, lease
        self.poll_seconds = max(1, poll_seconds)
        self.budget = max(1, min(files_per_pass, 500))
        self.position = 0
        self.dirty = asyncio.Event()
        self.native_events = False
        self.state = None

    async def send(self, operation, **body):
        return await self.transport.post(
            operation, {"lease": self.lease.model_dump(mode="json"), **body}
        )

    async def heartbeat(self):
        while True:
            value = await self.send("heartbeat")
            # Expired read-only follow may resume its same nonce and checkpoint.
            # It is never re-leased, and every frame rechecks the current source grant.
            if not value["active"]:
                await self.send("snapshot")
            await asyncio.sleep(15)

    async def watch_files(self, root):
        try:
            async for _ in awatch(root, debounce=150, step=50):
                self.dirty.set()
        except (OSError, RuntimeError):
            return

    async def watch_endpoint(self, endpoint):
        while True:
            try:
                async with httpx.AsyncClient(
                    trust_env=False,
                    follow_redirects=False,
                    timeout=httpx.Timeout(30, read=35),
                ) as client:
                    async with client.stream(
                        "GET", endpoint + "/event", headers={"Accept": "text/event-stream"}
                    ) as response:
                        response.raise_for_status()
                        if "text/event-stream" not in response.headers.get("content-type", ""):
                            return
                        self.native_events = True
                        self.dirty.set()
                        async for line in response.aiter_lines():
                            if line.startswith("data:"):
                                self.dirty.set()
            except (httpx.HTTPError, OSError):
                pass
            finally:
                self.native_events = False
            await asyncio.sleep(5)

    async def pending(self):
        frame = self.journal.read(self.lease)["pending"]
        if frame is None:
            return
        result = await self.transport.post("projection", frame)
        self.journal.acknowledge(self.lease, frame["frame_id"])
        if result["applied"]:
            self.state["checkpoints"][frame["locator"]] = frame["batch"]["checkpoint"]
        else:
            self.state = await self.send("snapshot")

    async def cycle(self, adapter, root):
        await self.pending()
        locators = await asyncio.to_thread(adapter.discover, root)
        if len(locators) > 100000:
            raise ValueError("原生来源记录过多")
        hot = min(20, self.budget // 2)
        cold = locators[hot:]
        count = max(1, self.budget - hot)
        offset = self.position % max(1, len(cold))
        selected = list(
            dict.fromkeys(locators[:hot] + (cold + cold)[offset : offset + min(count, len(cold))])
        )
        self.position += count
        errors, incomplete = {}, False
        for locator in selected:
            previous = self.state["checkpoints"].get(locator, {})
            try:
                batch = await asyncio.to_thread(adapter.watch, root, locator, previous)
                incomplete = incomplete or not batch.complete
                if batch.checkpoint != previous:
                    self.journal.stage(
                        self.lease, locator=locator, expected=previous, batch=asdict(batch)
                    )
                    await self.pending()
            except (OSError, ValueError, KeyError, TypeError) as exc:
                errors[locator] = type(exc).__name__
        indexed = sum(
            1
            for locator in locators
            if self.state["checkpoints"].get(locator, {}).get("complete", False)
        )
        await self.send(
            "cycle",
            locators=locators,
            errors=errors,
            incomplete=incomplete or indexed < len(locators),
            native_events=self.native_events,
        )

    async def run(self):
        self.state = await self.send("snapshot")
        root, endpoint = validate_location(
            agent_id=self.state["agent_id"],
            root=self.state["root"],
            endpoint=self.state["endpoint"],
        )
        adapter = get_adapter(self.state["agent_id"], endpoint)
        heartbeat = asyncio.create_task(self.heartbeat())
        watcher = asyncio.create_task(
            self.watch_endpoint(endpoint) if endpoint else self.watch_files(root)
        )
        try:
            while True:
                if heartbeat.done():
                    heartbeat.result()
                self.dirty.clear()
                await self.cycle(adapter, root)
                deadline = time.monotonic() + (5 if endpoint else self.poll_seconds)
                while time.monotonic() < deadline and not self.dirty.is_set():
                    if heartbeat.done():
                        heartbeat.result()
                    await asyncio.sleep(min(0.2, max(0, deadline - time.monotonic())))
        except LeaseEnded:
            self.journal.end(self.lease)
        except ProtocolConflict:
            logger.error("Native projection receipt conflict; retained for review")
            raise
        finally:
            heartbeat.cancel()
            watcher.cancel()
            await asyncio.gather(heartbeat, watcher, return_exceptions=True)
