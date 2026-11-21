"""Portable shot plans follow remapped nodes and the exported script."""

from studio.apps.visual_workshop.storyboard.models import VisualStoryboard
from studio.apps.visual_workshop.storyboard.schemas import StoryboardOut
from studio.runtime.files.project_archives import ProjectSnapshotError


async def export_storyboard(session, project_id):
    row = await session.get(VisualStoryboard, project_id)
    return {"shots": row.shots, "revision": row.revision} if row else None


def import_storyboard(payload, project_id, node_ids, scene_ids=None):
    if payload.get("storyboard") is None:
        return None, False
    try:
        document = StoryboardOut.model_validate(payload["storyboard"])
        detached = False
        shots = []
        for shot in document.shots:
            data = shot.model_dump(mode="json")
            for field in ("image_node_id", "video_node_id", "origin_node_id"):
                data[field] = node_ids.get(data[field])
            # Account-wide design cards are deliberately not part of portable project
            # archives. Re-select from the destination account rather than leaking IDs.
            detached |= bool(data["card_ids"])
            data["card_ids"] = []
            if data.get("previs"):
                target = (scene_ids or {}).get(data["previs"]["scene_id"])
                if target:
                    data["previs"]["scene_id"] = target
                    data["previs"]["stage_revision"] = 0
                else:
                    data["previs"] = None
                    detached = True
            shots.append(data)
        return VisualStoryboard(project_id=project_id, shots=shots, revision=0), detached
    except (TypeError, ValueError) as exc:
        raise ProjectSnapshotError("分镜快照结构无效") from exc
