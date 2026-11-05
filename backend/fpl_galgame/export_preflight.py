"""Build the video preflight from the owned Story and live service projections."""

import httpx

from app.apps.galgame_workshop.video.export_preview import preview_export
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_render import CAPACITY_PREFIX, CAPACITY_PURPOSE, RendererCapacity
from fpl_runtime.motion_preview import FrameFile
from fpl_runtime.motion_snapshot import SnapshotScope
from fpl_runtime.project_errors import ProjectResourceError


async def capacity(request, project_id):
    path = f"{CAPACITY_PREFIX}/{project_id}"
    client = request.app.state.capabilities
    grant = RequestGrant(
        "galgame", CAPACITY_PURPOSE, "POST", request.url.path, "rendering", "GET", path
    )
    try:
        token = await client.authorize_request(request.state.service_assertion, grant)
        response = await client.client.get("http://rendering:8080" + path, headers={HEADER: token})
        if response.status_code in {401, 403}:
            raise CapabilityDenied(response.status_code)
        response.raise_for_status()
        return RendererCapacity.model_validate_json(response.content)
    except CapabilityDenied as exc:
        raise ProjectResourceError(
            "视频预检权限已撤销", "render_preflight_denied", exc.status
        ) from exc
    except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise ProjectResourceError(
            "视频渲染环境暂不可核验", "render_preflight_unavailable", 503
        ) from exc


async def export_context(request, files, project_id, body):
    story = await files.projects.story(project_id)
    ids = {asset.file_id for asset in story.document.assets}
    rows = await files.asset_records(project_id, ids, newest_first=False) if ids else ()
    by_id = {row.id: row for row, _ in rows if row.id in ids}
    durations = {
        row.id: metadata.duration_ms
        for row, metadata in rows
        if metadata is not None and metadata.duration_ms is not None and row.id in ids
    }
    await files.session.rollback()
    renderer = await capacity(request, project_id)
    preview = preview_export(
        story,
        body,
        assets_by_file=by_id,
        available={row.id for row in by_id.values() if row.exists},
        durations_by_file=durations,
        capacity=renderer,
    )

    return story, by_id, durations, preview


async def export_preview(request, files, project_id, body):
    _, _, _, preview = await export_context(request, files, project_id, body)
    return preview


def frozen_plan(story, assets, durations, preview, payload):
    return {
        "document": story.document.model_dump(mode="json", by_alias=True),
        "payload": {**payload, "resolvedFragmentIds": preview.route.fragment_ids},
        "scope": SnapshotScope(
            files=tuple(FrameFile(id=key, revision=assets[key].revision) for key in sorted(assets))
        ),
        "sizes": {key: asset.byte_size for key, asset in assets.items()},
        "durations": {
            item.id: durations[item.file_id]
            for item in story.document.assets
            if item.file_id in durations
        },
        "fragment_durations_ms": preview.route.fragment_durations_ms,
        "total_ms": preview.route.estimated_duration_ms,
    }
