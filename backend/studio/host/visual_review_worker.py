"""Run frozen review tasks on a Mac with task-local files and durable native receipts."""

import asyncio
import json
import logging
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx

from app.capabilities.agents.cli.catalog import connection, execution_signature
from app.capabilities.agents.cli.process import probe
from studio.apps.visual_workshop.acceptance.execution.task_execution import execute_review_task
from studio.apps.visual_workshop.acceptance.execution.task_tools import file_digest, safe_file
from studio.config.settings import get_cloud_settings
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.visual_workshop.visual_agent_report import AgentReport
from studio.contracts.visual_workshop.visual_agent_review import (
    OPERATION,
    AgentReviewPlan,
    AgentReviewReceipt,
    ExtraReviewFrame,
)
from studio.runtime.http.framed_media import SIZE, FramedInputs

from .receipts import ReceiptStore
from .transport import LeaseEnded, ProtocolConflict

logger = logging.getLogger(__name__)


class VisualReviewWorker:
    def __init__(self, transport, state_root, *, executor=None, configured=None):
        self.transport = transport
        self.state_root = state_root.resolve()
        self.receipts = ReceiptStore(
            self.state_root / "receipts", retain_acknowledged_payload=False
        )
        self.executor = executor
        self.configured = configured or configured_connection

    async def authorize(self, lease):
        value = await self.transport.post(
            "review/authorize", {"lease": lease.model_dump(mode="json")}
        )
        if value.get("active") is not True:
            raise LeaseEnded("视觉验收租约已结束")

    async def perform(self, lease):
        if lease.operation != OPERATION:
            raise ProtocolConflict("租约不是固定 Visual 验收任务")
        plan = AgentReviewPlan.model_validate(lease.payload)
        try:
            await self.authorize(lease)
            executable = await self.configured(plan.agent, plan.connection_signature)
            if not executable:
                return NativeOutcome(status="failed", error_code="connection_changed")
            with TemporaryDirectory(prefix="review-", dir=self.state_root) as directory:
                root = Path(directory)
                await self.download_with_heartbeat(lease, plan, root)

                async def cancelled():
                    try:
                        await self.authorize(lease)
                        return False
                    except (LeaseEnded, httpx.HTTPError):
                        return True

                kwargs = {"executor": self.executor} if self.executor is not None else {}
                report, extras, read = await execute_review_task(
                    plan.agent,
                    executable,
                    root,
                    {
                        "criteria": plan.task.criteria,
                        "metadata": {"duration_ms": plan.task.duration_ms},
                    },
                    [item.model_dump() for item in plan.evidence],
                    cancelled,
                    **kwargs,
                )
                await self.authorize(lease)
                frames = []
                for item in extras:
                    path = safe_file(root, item["file"])
                    frame = ExtraReviewFrame(
                        id=item["id"],
                        source_asset_id=item["source_asset_id"],
                        position_ms=item["position_ms"],
                        sha256=item["sha256"],
                        byte_size=path.stat().st_size,
                    )
                    await self.upload(lease, frame, path)
                    frames.append(frame)
                receipt = AgentReviewReceipt(report=report, frames=frames, read_ids=read)
                return NativeOutcome(status="completed", result=receipt.model_dump(mode="json"))
        except LeaseEnded:
            return NativeOutcome(status="failed", error_code="authorization_revoked")

    async def download_with_heartbeat(self, lease, plan, root):
        task = asyncio.create_task(self.download(lease, plan, root))
        try:
            while not task.done():
                await asyncio.wait({task}, timeout=15)
                if not task.done():
                    await self.authorize(lease)
            await task
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def download(self, lease, plan, root):
        total = sum(SIZE.size + item.byte_size for item in plan.files)
        if total > shutil.disk_usage(root).free:
            raise OSError("验收任务暂存空间不足")
        locations = {}
        async with self.transport.client.stream(
            "POST",
            "_native/v1/review/media",
            json={"lease": lease.model_dump(mode="json")},
            headers={"Accept-Encoding": "identity"},
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code in (403, 410):
                raise LeaseEnded("视觉验收租约已结束")
            response.raise_for_status()
            if (
                response.headers.get("Content-Type") != "application/octet-stream"
                or response.headers.get("Content-Encoding", "identity") != "identity"
                or int(response.headers["Content-Length"]) != total
            ):
                raise ProtocolConflict("验收素材传输长度已变化")
            framed = FramedInputs(response.aiter_bytes(1024 * 1024))
            for index, file in enumerate(plan.files):
                size = SIZE.unpack(await framed.read(SIZE.size))[0]
                if size != file.byte_size:
                    raise ProtocolConflict("验收原件传输长度已变化")
                suffix = ".png" if file.media_kind == "image" else ".mp4"
                target = root / f"input-{index}{suffix}"
                with target.open("xb") as output:
                    target.chmod(0o600)
                    await framed.transfer(output, size)
                locations[file.id] = (target.name, await asyncio.to_thread(file_digest, target))
            await framed.require_end(total)
        task = plan.task.model_dump(exclude={"duration_ms"})
        media = [
            manifest_file(
                locations[item.asset_id], item.asset_id, item.asset_id, item.kind, item.label, None
            )
            for item in plan.media
        ]
        evidence = [
            manifest_file(
                locations[item.asset_id],
                item.id,
                item.source_asset_id,
                "image",
                "验收证据",
                item.position_ms,
            )
            for item in plan.evidence
        ]
        document = {"task": task, "media": media, "evidence": evidence}
        (root / "manifest.json").write_text(
            json.dumps(document, ensure_ascii=False), encoding="utf-8"
        )
        (root / "output-schema.json").write_text(
            json.dumps(AgentReport.model_json_schema()), encoding="utf-8"
        )

    async def upload(self, lease, frame, path):
        url = (
            f"_native/v1/review/artifacts/{lease.job_id}/{lease.lease_id}/{frame.id}/{frame.sha256}"
        )
        headers = {"Content-Type": "image/png", "Content-Length": str(frame.byte_size)}
        for retry in (False, True):
            try:
                response = await self.transport.client.post(
                    url, content=await asyncio.to_thread(path.read_bytes), headers=headers
                )
                break
            except httpx.TransportError:
                if retry:
                    raise
        if response.status_code in (403, 410):
            raise LeaseEnded("视觉验收租约已结束")
        response.raise_for_status()
        if response.json().get("sha256") != frame.sha256:
            raise ProtocolConflict("视觉验收证据回执未确认")

    async def deliver(self, lease, outcome):
        response = await self.transport.post(
            "review/receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if response.get("acknowledged") is not True:
            raise ProtocolConflict("视觉验收回执未确认")
        await asyncio.to_thread(self.receipts.acknowledge, lease)

    async def poll_once(self):
        for lease, stored in await asyncio.to_thread(lambda: list(self.receipts.pending())):
            outcome = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await self.receipts.execute_async(lease, self.perform)
            )
            await self.deliver(lease, outcome)
        claim = await self.transport.post("review/claim", {})
        if claim.get("lease") is not None:
            lease = NativeLease.model_validate(claim["lease"])
            await self.deliver(lease, await self.receipts.execute_async(lease, self.perform))

    async def run(self):
        try:
            while True:
                try:
                    await self.poll_once()
                    await asyncio.sleep(0.5)
                except (httpx.HTTPError, OSError, LeaseEnded, ProtocolConflict):
                    logger.warning("Mac 视觉验收授权或回执等待恢复")
                    await asyncio.sleep(2)
        finally:
            await self.transport.close()


def manifest_file(location, identity, source, kind, label, position):
    filename, digest = location
    return {
        "id": identity,
        "source_asset_id": source,
        "file": filename,
        "sha256": digest,
        "kind": kind,
        "label": label,
        "position_ms": position,
    }


async def configured_connection(agent, signature):
    _enabled, path, _error = connection(get_cloud_settings(), agent)
    if not path or execution_signature(agent, path) != signature:
        return None
    available, _message = await probe(agent, path)
    return path if available else None
