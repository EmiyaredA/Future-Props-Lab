"""Verify the Annotation snapshot, source bytes and Galgame master audio."""

import re

import httpx

from app.apps.galgame_workshop.assets.annotation_preview import build_import_preview
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_annotation_source import (
    ANNOTATION_PATH,
    ANNOTATION_PURPOSE,
    AUDIO_PATH,
    AUDIO_PURPOSE,
    AnnotationSource,
    AudioDigest,
)
from fpl_runtime.library_assets import ID
from fpl_runtime.project_errors import ProjectResourceError


async def read_peer(files, service, purpose, path, schema, missing):
    peer = files.capabilities
    grant = RequestGrant("galgame", purpose, "POST", files.source_path, service, "GET", path)
    try:
        token = await peer.authorize_request(files.assertion, grant)
        reply = await peer.client.get(
            f"http://{service}:8080" + path,
            headers={HEADER: token},
            timeout=httpx.Timeout(60, connect=5),
        )
        if reply.status_code in {401, 403}:
            raise CapabilityDenied(reply.status_code)
        if reply.status_code == 404:
            raise missing
        reply.raise_for_status()
        return schema.model_validate_json(reply.content)
    except CapabilityDenied as exc:
        raise ProjectResourceError(
            "标注导入授权已失效", "annotation_source_denied", exc.status
        ) from exc
    except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise ProjectResourceError(
            "标注导入来源暂不可核验", "annotation_source_unavailable", 503
        ) from exc


async def annotation_preview(files, project_id, body):
    story = await files.projects.story(project_id)
    source_id = body.source_project_id
    missing = ProjectResourceError("广播剧标注项目不存在")
    if not re.fullmatch(ID, source_id):
        raise missing
    await files.session.rollback()
    source = await read_peer(
        files,
        "annotation",
        ANNOTATION_PURPOSE,
        f"{ANNOTATION_PATH}/{project_id}/{source_id}",
        AnnotationSource,
        missing,
    )
    digest = await read_peer(
        files,
        "assets",
        AUDIO_PURPOSE,
        f"{AUDIO_PATH}/{project_id}/{source.id}/{source.asset_id}",
        AudioDigest,
        ProjectResourceError("广播剧源音频不可用", "source_audio_missing"),
    )
    master_rows = (
        await files.asset_records(
            project_id,
            (),
            newest_first=False,
            project_file_id=body.master_asset_id,
            replacement=True,
        )
        if re.fullmatch(ID, body.master_asset_id)
        else ()
    )
    master, metadata = master_rows[0] if master_rows else (None, None)
    matches = bool(
        master
        and master.exists
        and master.media_kind == "audio"
        and metadata
        and metadata.project_id == project_id
        and metadata.duration_ms == source.duration_ms
        and metadata.checksum_sha256 == digest.sha256
    )
    return build_import_preview(story, body, source, digest.sha256, matches)
