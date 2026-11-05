"""Native collector restart and lost-ack journey, using fixture files and ASGI transport."""

import asyncio
import json

import httpx

from studio.contracts.agent_workbench.native import NativeLease
from studio.host.session_collection.collector import Collector


async def verify_follow(
    client, native_headers, lease_value, source, native_root, actor_headers, identity
):
    native = native_root / "rollout-real.jsonl"
    records = [
        {
            "type": "session_meta",
            "payload": {
                "id": "native-two",
                "cwd": "/fixture",
                "source": "cli",
                "originator": "codex_cli_rs",
            },
        },
        {
            "type": "response_item",
            "payload": {
                "id": "first",
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "before lost acknowledgement"}],
            },
        },
    ]
    original = "".join(json.dumps(row) + "\n" for row in records).encode()
    native.write_bytes(original)
    lease = NativeLease.model_validate(lease_value)
    root = native_root.parent / "collector-recovery"
    sessions_path = "/v1/agent-workbench/sessions"

    unavailable = asyncio.Event()

    class Transport:
        lose_ack = True

        def __init__(self):
            self.requests = set()

        async def post(self, operation, body):
            from studio.host.transport import LeaseEnded, ProtocolConflict

            if operation == "claim":
                body = {**body, "wait_seconds": 0}
            # A client process stopping does not cancel the server's SQLite write.
            pending = asyncio.create_task(
                client.post("/_native/v1/" + operation, headers=native_headers, json=body)
            )
            self.requests.add(pending)
            pending.add_done_callback(self.requests.discard)
            response = await asyncio.shield(pending)
            if (
                operation == "claim"
                and response.status_code == 200
                and not response.json()["lease"]
            ):
                await asyncio.sleep(0.05)
            if response.status_code in {403, 410}:
                raise LeaseEnded()
            if response.status_code in {409, 422}:
                raise ProtocolConflict(response.text)
            if response.status_code == 503:
                unavailable.set()
            response.raise_for_status()
            if operation == "projection" and self.lose_ack:
                self.lose_ack = False
                raise httpx.ReadError("fixture: reply lost after durable projection")
            return response.json()

        async def close(self):
            await asyncio.gather(*self.requests, return_exceptions=True)

    transport = Transport()
    collector = Collector(transport, root)
    collector.journal.read(lease)
    task = asyncio.create_task(collector.run())
    try:
        async with asyncio.timeout(10):
            while collector.journal.read(lease)["pending"] is None or transport.lose_ack:
                await asyncio.sleep(0.02)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    response = await client.get(sessions_path, headers=actor_headers("GET", sessions_path))
    copied = next(row for row in response.json()["items"] if row["native_id"] == "native-two")
    history_path = f"{sessions_path}/{copied['id']}/history"
    response = await client.get(history_path, headers=actor_headers("GET", history_path))
    assert len(response.json()["items"]) == 1

    addition = (
        json.dumps(
            {
                "type": "response_item",
                "payload": {
                    "id": "second",
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        {"type": "output_text", "text": "arrived during collector restart"}
                    ],
                },
            }
        )
        + "\n"
    )
    with native.open("a") as stream:
        stream.write(addition)
    restarted = Collector(transport, root)
    task = asyncio.create_task(restarted.run())
    try:
        async with asyncio.timeout(10):
            while True:
                response = await client.get(
                    history_path, headers=actor_headers("GET", history_path)
                )
                if len(response.json()["items"]) == 2:
                    break
                if task.done():
                    task.result()
                await asyncio.sleep(0.05)
        assert restarted.journal.read(lease)["pending"] is None
        identity.available = False
        async with asyncio.timeout(10):
            await unavailable.wait()
        assert restarted.journal.read(lease)["ended"] is False
        identity.available = True
        after_outage = (
            json.dumps(
                {
                    "type": "response_item",
                    "payload": {
                        "id": "third",
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "after Identity recovered"}],
                    },
                }
            )
            + "\n"
        )
        with native.open("a") as stream:
            stream.write(after_outage)
        async with asyncio.timeout(10):
            while True:
                response = await client.get(
                    history_path, headers=actor_headers("GET", history_path)
                )
                if len(response.json()["items"]) == 3:
                    break
                await asyncio.sleep(0.05)
        source_path = f"/v1/agent-workbench/sources/{source['id']}"
        paused = await client.patch(
            source_path,
            headers=actor_headers("PATCH", source_path),
            json={"expected_revision": source["revision"], "enabled": False},
        )
        assert paused.status_code == 200, paused.text
        rejected = await client.post(
            "/_native/v1/snapshot", headers=native_headers, json={"lease": lease_value}
        )
        assert rejected.status_code == 410
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert native.read_bytes() == original + addition.encode() + after_outage.encode()
