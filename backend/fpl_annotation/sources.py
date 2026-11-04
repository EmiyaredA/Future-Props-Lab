"""Use request-bound Assets capabilities for audio inputs and committed references."""

import asyncio
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import httpx

from app.apps.audio_annotation.sources import AnnotationAudio, AudioAnnotationError
from fpl_runtime.annotation_assets import (
    MAX_AUDIO_BYTES,
    MAX_IDS,
    PURPOSE,
    AudioAssetDescription,
    AudioAssetQuery,
)
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.project_errors import ProjectResourceError


class Inputs:
    def __init__(self, connection, session, capabilities, staging):
        self.connection, self.session = connection, session
        self.capabilities, self.staging = capabilities, staging

    def _scope(self, target):
        return RequestGrant(
            "annotation",
            PURPOSE,
            self.connection.method,
            self.connection.url.path,
            "assets",
            "GET",
            target,
        )

    async def _token(self, target):
        return await self.capabilities.authorize_request(
            self.connection.state.service_assertion, self._scope(target)
        )

    async def describe_many(self, ids):
        output = {}
        ordered = sorted(ids)
        for start in range(0, len(ordered), MAX_IDS):
            query = AudioAssetQuery(asset_ids=ordered[start : start + MAX_IDS])
            try:
                token = await self._token(query.path)
                response = await self.capabilities.client.get(
                    "http://assets:8080" + query.path,
                    params={"id": query.asset_ids},
                    headers={"X-Fpl-Context": token},
                )
                if response.status_code == 404:
                    return {}
                response.raise_for_status()
                items = [
                    AudioAssetDescription.model_validate(item) for item in response.json()["items"]
                ]
                if [item.id for item in items] != query.asset_ids:
                    raise ValueError("metadata mismatch")
            except (
                CapabilityDenied,
                CapabilityUnavailable,
                httpx.HTTPError,
                ValueError,
                KeyError,
                TypeError,
            ):
                raise AudioAnnotationError(
                    "素材描述暂不可用", code="asset_unavailable", status=503
                ) from None
            owner = self.session.info["owner_user_id"]
            output.update(
                {item.id: AnnotationAudio(item, owner, item.display_name) for item in items}
            )
        return output

    async def describe(self, asset_id):
        return (await self.describe_many({asset_id})).get(asset_id)

    @asynccontextmanager
    async def open(self, audio):
        description = audio.description
        path = description.content_path
        try:
            token = await self._token(path)
            with tempfile.TemporaryDirectory(prefix="audio-", dir=self.staging) as location:
                target = Path(location) / ("input" + Path(description.original_filename).suffix)
                async with self.capabilities.client.stream(
                    "GET",
                    "http://assets:8080" + path,
                    headers={"X-Fpl-Context": token, "Accept-Encoding": "identity"},
                    timeout=httpx.Timeout(120, connect=5),
                ) as response:
                    if response.status_code == 404:
                        raise AudioAnnotationError(
                            "音频文件内容不存在", code="file_missing", status=404
                        )
                    if response.status_code == 409:
                        raise AudioAnnotationError(
                            "音频版本已变化，请重试", code="source_changed", status=409
                        )
                    response.raise_for_status()
                    if (
                        response.headers.get("Content-Encoding", "identity") != "identity"
                        or response.headers.get("X-Fpl-File-Revision") != str(description.revision)
                        or int(response.headers["Content-Length"]) != description.byte_size
                        or description.byte_size > MAX_AUDIO_BYTES
                    ):
                        raise ValueError("source headers mismatch")
                    size = 0
                    with target.open("xb") as handle:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                            size += len(chunk)
                            if size > description.byte_size:
                                raise ValueError("source size mismatch")
                            await asyncio.to_thread(handle.write, chunk)
                    if size != description.byte_size:
                        raise ValueError("source size mismatch")
                yield target
        except (
            CapabilityDenied,
            CapabilityUnavailable,
            httpx.HTTPError,
            OSError,
            ValueError,
            KeyError,
        ):
            raise AudioAnnotationError(
                "音频原件暂不可用", code="asset_unavailable", status=503
            ) from None

    async def transcription(self, _task_id):
        raise AudioAnnotationError(
            "识别结果暂不可导入", code="transcription_unavailable", status=503
        )


class ProjectReferences:
    def __init__(self, connection, session, coordinator):
        self.connection, self.session, self.coordinator = connection, session, coordinator

    async def prepare(self, project_id, *, expected, asset_ids):
        try:
            return await self.coordinator.prepare(
                owner=self.session.info["owner_user_id"],
                assertion=self.connection.state.service_assertion,
                source_method=self.connection.method,
                source_path=self.connection.url.path,
                change=PrepareReferenceChange(
                    request_id=uuid4().hex,
                    resource_kind="project",
                    resource_id=project_id,
                    expected_resource_revision=expected,
                    asset_ids=asset_ids,
                ),
            )
        except CapabilityDenied as exc:
            if exc.status == 404:
                raise AudioAnnotationError("音频文件不存在", code="not_found", status=404) from exc
            if exc.code == "reference_projection_required":
                raise AudioAnnotationError(
                    "音频引用尚未核验", code="retention_unconfirmed", status=503
                ) from exc
            raise AudioAnnotationError(
                "素材引用准备被拒绝", code="retention_denied", status=exc.status
            ) from exc
        except (CapabilityUnavailable, ProjectResourceError) as exc:
            raise AudioAnnotationError(
                "素材引用结果未确认", code="retention_unconfirmed", status=503
            ) from exc

    async def record(self, session, prepared, **result):
        await self.coordinator.record(session, prepared, **result)

    async def abort(self, session, prepared):
        await self.coordinator.abort_after_rollback(session, prepared)
