"""Stage exact upload bytes in Assets before applying one owned Canvas mutation."""

import hashlib
import re
from pathlib import Path
from uuid import uuid4

import httpx
from pydantic import Field, ValidationError
from sqlalchemy import text

from app.capabilities.asset_store.policy import normalize_content_type
from studio.apps.visual_workshop.canvas_asset_values import expected_assets
from studio.apps.visual_workshop.canvas_documents import CanvasDocuments, VisualCanvasError
from studio.apps.visual_workshop.canvas_values import canvas_out
from studio.apps.visual_workshop.handoffs.segment_handoffs import require_canvas_unreserved
from studio.apps.visual_workshop.outputs.mutations import OutputMutations
from studio.apps.visual_workshop.outputs.queries import OutputError
from studio.apps.visual_workshop.outputs.schemas import VisualNodeOutputCreateIn
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentPutIn,
    VisualCanvasPosition,
)
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.thought_workshop.thought_assets import AssetDescription
from studio.contracts.visual_workshop.visual_upload import VisualUpload
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.ids import new_id
from studio.runtime.project_errors import ProjectResourceError

from .canvas_writes import CanvasWrites, conflict
from .projects import Projects
from .reference_backlog import pending_outcomes

CHUNK = 1024 * 1024


class UploadedAsset(AssetDescription):
    display_name: str = Field(min_length=1, max_length=255)


async def upload_bytes(file):
    while chunk := await file.read(CHUNK):
        yield chunk


async def describe(file, kind, *, composition_batch_id=None, generation_task_id=None):
    checksum = hashlib.sha256()
    size = 0
    async for chunk in upload_bytes(file):
        checksum.update(chunk)
        size += len(chunk)
    await file.seek(0)
    mime = normalize_content_type(file.content_type)
    if not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", mime) or len(mime) > 255:
        mime = "application/octet-stream"
    try:
        return VisualUpload(
            kind=kind,
            filename=Path((file.filename or "").replace("\\", "/")).name,
            mime_type=mime,
            byte_size=size,
            content_sha256=checksum.hexdigest(),
            composition_batch_id=composition_batch_id,
            generation_task_id=generation_task_id,
        )
    except ValueError as exc:
        raise OutputError("上传文件名、格式或内容无效", code="invalid_file_content") from exc


def media_receipt(reply, kind):
    if reply.status_code != 200:
        if reply.status_code in {401, 403, 404, 409, 413, 422}:
            payload = reply.json()
            raise ProjectResourceError(
                payload.get("title") or "项目上传失败",
                payload.get("code") or "visual_upload_denied",
                reply.status_code,
            )
        raise CapabilityUnavailable("上传回执暂不可用")
    data = reply.json()["items"]
    if not isinstance(data, list) or not 1 <= len(data) <= 2:
        raise ValueError("invalid upload receipt")
    assets = tuple(UploadedAsset.model_validate(value) for value in data)
    allowed = {"image", "video", "audio"} if kind == "material" else {kind}
    if (
        assets[0].media_kind not in allowed
        or any(item.revision != 0 for item in assets)
        or (
            len(assets) == 2
            and (
                kind != "video"
                or assets[1].media_kind != "video"
                or assets[1].mime_type != "video/webm"
                or assets[1].id == assets[0].id
            )
        )
    ):
        raise ValueError("unexpected visual upload assets")
    return assets


class Uploads:
    def __init__(
        self, state, session, owner, assertion, source_path, *, generation_plan_sha256=None
    ):
        self.session, self.owner = session, owner
        self.projects = Projects(session, owner)
        self.references = state.reference_mutations
        self.delivery = state.reference_delivery
        self.assertion, self.source_path = assertion, source_path
        self.generation_plan_sha256 = generation_plan_sha256

    @classmethod
    def from_request(cls, request, session, owner):
        return cls(
            request.app.state, session, owner, request.state.service_assertion, request.url.path
        )

    async def _prepare(self, change):
        try:
            return await self.references.prepare(
                owner=self.owner,
                assertion=self.assertion,
                source_method="POST",
                source_path=self.source_path,
                change=change,
                generation_plan_sha256=self.generation_plan_sha256,
            )
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            await self.references.abandon_preparation(self.session, self.owner, change)
            if isinstance(exc, CapabilityDenied):
                if exc.status == 409:
                    current = await self.projects.canvas(change.resource_id)
                    if current.revision != change.expected_resource_revision:
                        raise conflict(change.expected_resource_revision, current) from exc
                raise ProjectResourceError(
                    "项目上传范围不可用", exc.code or "visual_upload_denied", exc.status
                ) from exc
            raise ProjectResourceError(
                "上传准备结果未确认", "visual_upload_unconfirmed", 503
            ) from exc
        except ProjectResourceError:
            await self.references.abandon_preparation(self.session, self.owner, change)
            raise

    async def _stage(self, prepared, file, description):
        client = self.references.client
        path = client.assets_url + f"/_internal/v1/visual-upload/{prepared.asset_intent_id}"
        headers = {"Authorization": "Bearer " + prepared.authority}
        try:
            try:
                reply = await client.client.post(
                    path,
                    headers={**headers, "Content-Length": str(description.byte_size)},
                    content=upload_bytes(file),
                    timeout=180,
                )
            except httpx.TransportError as interrupted:
                reply = await client.client.get(path, headers=headers)
                if reply.status_code != 200:
                    raise CapabilityUnavailable("上传结果尚未确认") from interrupted
            return media_receipt(reply, description.kind)
        except (httpx.HTTPError, KeyError, TypeError, ValueError, CapabilityUnavailable) as exc:
            raise ProjectResourceError("上传结果未确认", "visual_upload_unconfirmed", 503) from exc

    async def stage_and_commit(
        self,
        current,
        expected,
        file,
        kind,
        apply,
        *,
        composition_batch_id=None,
        generation_task_id=None,
        required_asset_ids=(),
    ):
        if current.revision != expected:
            raise conflict(expected, current)
        project_id = current.project_id
        await require_canvas_unreserved(self.session, self.owner, project_id)
        canvas = CanvasWrites(self.session, self.owner, self.references, self.assertion)
        carried = await canvas.history_assets(project_id, {node.id for node in current.nodes})
        carried.update(asset_id for asset_id, _ in expected_assets(current.nodes))
        for identity in await pending_outcomes(self.session, project_id):
            await self._deliver(identity)
        description = await describe(
            file,
            kind,
            composition_batch_id=composition_batch_id,
            generation_task_id=generation_task_id,
        )
        change = PrepareReferenceChange(
            request_id=uuid4().hex,
            resource_kind="canvas",
            resource_id=project_id,
            expected_resource_revision=expected,
            asset_ids=sorted(carried),
            metadata_asset_ids=[],
            carried_asset_ids=sorted(carried),
            visual_upload=description,
        )
        prepared = await self._prepare(change)
        try:
            if set(required_asset_ids) & prepared.unavailable_asset_ids:
                raise ProjectResourceError(
                    "生成结果引用的素材已不可用", "generation_reference_missing", 409
                )
            assets = await self._stage(prepared, file, description)
        except BaseException:
            await self.references.abort_after_rollback(self.session, prepared)
            raise

        async def write():
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await require_canvas_unreserved(self.session, self.owner, project_id)
            return await apply(assets, prepared.request_id)

        result = await self.references.commit_source(self.session, prepared, write)
        await self._deliver(prepared.request_id)
        return result

    async def _deliver(self, identity):
        try:
            await self.delivery.deliver(self.owner, identity)
        except (CapabilityDenied, CapabilityUnavailable) as exc:
            raise ProjectResourceError(
                "上传发布结果未确认", "visual_upload_unconfirmed", 503
            ) from exc

    async def output(self, project, node_id, file, expected):
        outputs = OutputMutations(self.session, self.owner)
        canvas, node = await outputs.document(project, node_id)
        if node["kind"] == "text":
            raise OutputError("文本节点请使用保存版本")
        current = canvas_out(canvas)

        async def apply(assets, _request_id):
            return await outputs.append(
                project,
                node_id,
                VisualNodeOutputCreateIn(expected_revision=expected, asset_id=assets[0].id),
                inspection_asset_id=assets[1].id if len(assets) == 2 else None,
            )

        return await self.stage_and_commit(current, expected, file, node["kind"], apply)

    async def material(self, project, file, expected, x, y, category_id, group):
        current = await self.projects.canvas(project)
        if current.revision != expected:
            raise conflict(expected, current)
        category = next((item for item in current.categories if item.id == category_id), None)
        if category_id and category is None:
            raise VisualCanvasError("上传目标分类不存在")
        if group and (category is None or group not in category.groups):
            raise VisualCanvasError("上传目标分组不存在")
        try:
            position = VisualCanvasPosition(x=x, y=y)
        except ValidationError as exc:
            raise VisualCanvasError("上传位置无效") from exc

        async def verified_assets(*_scope):
            # Existing references were carried and the new original was sealed
            # by Assets before entering this Canvas write.
            pass

        async def apply(assets, _request_id):
            original = assets[0]
            body = VisualCanvasDocumentPutIn(
                expected_revision=expected,
                nodes=[
                    *current.nodes,
                    {
                        "id": new_id(),
                        "kind": original.media_kind,
                        "title": original.display_name[:120],
                        "position": position.model_dump(),
                        "asset_id": original.id,
                        "category_id": category_id or None,
                        "group": group or None,
                    },
                ],
                edges=current.edges,
            )
            return await CanvasDocuments(self.session, validate_assets=verified_assets).replace(
                project, body
            )

        return await self.stage_and_commit(current, expected, file, "material", apply)
