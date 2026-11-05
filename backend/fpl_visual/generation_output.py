"""Transfer the exact Models result and publish its Visual-owned history."""

import hashlib
import shutil
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from anyio import open_file

from app.apps.visual_workshop.canvas_values import canvas_out
from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.models import VisualGenerationTask
from app.apps.visual_workshop.node_placement import automatic_node_position
from app.apps.visual_workshop.outputs.recording import register_output
from app.runtime.ids import new_id
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable

from .canvas_writes import conflict
from .generation_dispatch_records import VisualGenerationDispatch
from .generation_peer import check
from .projects import Projects
from .uploads import Uploads


class ResultFile:
    def __init__(self, handle, name, mime):
        self.handle, self.filename, self.content_type = handle, name, mime

    async def read(self, size=-1):
        return await self.handle.read(size)

    async def seek(self, offset):
        await self.handle.seek(offset)


async def download(peer, base, owner, task_id, result, destination):
    target = base + f"/tasks/{task_id}/result/{result.sha256}"
    headers = peer.sign.headers("GET", target, owner)
    size, digest = 0, hashlib.sha256()
    try:
        async with peer.client.client.stream(
            "GET",
            "http://models:8080" + target,
            headers={**headers, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code != 200:
                await response.aread()
                check(response)
            if (
                response.headers.get("Content-Type") != result.mime_type
                or int(response.headers["Content-Length"]) != result.byte_size
                or response.headers.get("X-Fpl-Content-Sha256") != result.sha256
                or response.headers.get("Content-Encoding", "identity") != "identity"
            ):
                raise ValueError("model result headers changed")
            async with await open_file(destination, "xb") as file:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    size += len(chunk)
                    if size > result.byte_size:
                        raise ValueError("model result exceeds declared length")
                    digest.update(chunk)
                    await file.write(chunk)
        if size != result.byte_size or digest.hexdigest() != result.sha256:
            raise ValueError("model result bytes changed")
    except (httpx.HTTPError, OSError, ValueError, KeyError) as exc:
        raise CapabilityUnavailable("生成结果原件暂不可用") from exc


class GenerationOutput:
    def __init__(self, state, peer):
        self.state, self.peer = state, peer
        self.root = state.database.root / ".tmp" / "visual-model-results"

    async def publish(self, db, decision, task, dispatch, remote):
        if self.root.is_symlink() or not self.root.resolve().is_relative_to(
            self.state.database.root
        ):
            raise CapabilityUnavailable("生成结果暂存不可用")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if remote.result.byte_size > shutil.disk_usage(self.root).free:
            raise CapabilityUnavailable("生成结果暂存空间不足")
        task_id, owner, project = task.id, task.owner_user_id, task.project_id
        node_id, kind = task.canvas_node_id, task.generation_kind
        base = self.peer.path(decision)
        provenance = task.request_payload.get("input_snapshot", [])
        suffix = Path(remote.result.filename).suffix
        filename = f"{Path(task.model_slug).name}-{task_id[:8]}{suffix}"
        assertion = dispatch.retry_assertion or decision.source_assertion
        source = (
            f"/v1/visual-workshop/generation-tasks/{task_id}/retry-materialization"
            if dispatch.retry_assertion
            else decision.source_path
        )
        projects = Projects(db, owner)
        current = canvas_out(await projects.canvas_row(project))
        await db.rollback()
        receipt = None
        uploads = Uploads(self.state, db, owner, assertion, source)

        async def apply(assets, request_id):
            nonlocal receipt
            row = await db.get(VisualGenerationTask, task_id, populate_existing=True)
            local = await db.get(VisualGenerationDispatch, task_id, populate_existing=True)
            if (
                row is None
                or row.status != "processing"
                or local is None
                or local.pending_receipt_id
            ):
                raise GenerationError(
                    "生成任务已变化", code="visual_generation_conflict", status=409
                )
            canvas = await projects.canvas_row(project)
            if canvas.revision != current.revision:
                raise conflict(current.revision, canvas_out(canvas))
            nodes = deepcopy(canvas.nodes or [])
            asset = assets[0]
            node = next((row for row in nodes if row["id"] == node_id), None)
            if node_id is None:
                node = {
                    "id": new_id(),
                    "kind": kind,
                    "title": asset.display_name,
                    "position": automatic_node_position(nodes, kind),
                    "generation_task_id": task_id,
                }
                nodes.append(node)
            if node is not None and node["kind"] == kind:
                await register_output(
                    db,
                    project,
                    node,
                    source="generated",
                    source_key=f"task:{task_id}",
                    asset_id=asset.id,
                    task_id=task_id,
                    input_snapshot=provenance,
                    inspection_asset_id=assets[1].id if len(assets) == 2 else None,
                )
                row.canvas_node_id = node["id"]
            canvas.nodes = nodes
            canvas.revision += 1
            canvas.updated_at = utc_now()
            local.pending_asset_id, local.pending_receipt_id = asset.id, request_id
            local.remote_output_sha256 = remote.result.sha256
            receipt = request_id
            return canvas_out(canvas)

        with TemporaryDirectory(dir=self.root, prefix="result-") as staging:
            local = Path(staging) / "original"
            await download(self.peer, base, owner, task_id, remote.result, local)
            async with await open_file(local, "rb") as file:
                await uploads.stage_and_commit(
                    current,
                    current.revision,
                    ResultFile(file, filename, remote.result.mime_type),
                    kind,
                    apply,
                    generation_task_id=task_id,
                    required_asset_ids={
                        item["asset_id"] for item in provenance if item.get("asset_id")
                    },
                )
        return receipt
