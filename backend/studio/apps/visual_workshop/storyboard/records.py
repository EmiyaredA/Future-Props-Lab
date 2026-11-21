"""Short, owner-scoped CAS transactions for project shot plans."""

from sqlalchemy import text

from studio.apps.visual_workshop.creative_rules import check_source
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords
from studio.apps.visual_workshop.storage.models import VisualAssetCard, VisualPrevisScene
from studio.runtime.project_errors import ProjectResourceError

from .models import VisualStoryboard
from .schemas import StoryboardOut


class SqlStoryboardRecords:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.projects = Projects(session, owner)

    async def get(self, project_id):
        await self.projects.row(project_id)
        row = await self.session.get(VisualStoryboard, project_id, populate_existing=True)
        return (
            StoryboardOut(shots=row.shots, revision=row.revision)
            if row
            else StoryboardOut(revision=0)
        )

    async def save(self, project_id, body):
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            current = await self.get(project_id)
            if current.revision != body.expected_revision:
                raise ProjectResourceError(
                    "分镜已在其他窗口更新，请保留草稿并重新读取", "visual_storyboard_conflict", 409
                )
            canvas = await self.projects.canvas_row(project_id)
            nodes = {node["id"]: node for node in canvas.nodes or []}
            previous = {shot.id: shot for shot in current.shots}
            script = await SqlCreativeRecords(self.session, self.owner).script(project_id)
            project_cards = set(canvas.project_card_ids or [])
            for shot in body.shots:
                old = previous.get(shot.id)
                for field, kind in (("image_node_id", "image"), ("video_node_id", "video")):
                    identity = getattr(shot, field)
                    # Deleted historical links remain repairable. New links must exist.
                    if identity and (old is None or identity != getattr(old, field)):
                        if nodes.get(identity, {}).get("kind") != kind:
                            raise ProjectResourceError(
                                "分镜制作节点不属于当前项目或类型不符",
                                "visual_storyboard_reference",
                                422,
                            )
                if shot.origin_node_id and (
                    old is None or shot.origin_node_id != old.origin_node_id
                ):
                    if nodes.get(shot.origin_node_id, {}).get("kind") not in {"image", "video"}:
                        raise ProjectResourceError(
                            "分镜来源节点不存在", "visual_storyboard_reference", 422
                        )
                if shot.source and (old is None or shot.source != old.source):
                    check_source(script, shot.source)
                    if shot.source.excerpt:
                        scene = next(
                            scene
                            for episode in script.episodes
                            for scene in episode.scenes
                            if scene.id == shot.source.scene_id
                        )
                        if (
                            shot.source.start is None
                            or _excerpt(scene.text, shot.source.start, shot.source.end)
                            != shot.source.excerpt
                        ):
                            raise ProjectResourceError(
                                "剧本选区与当前版本不符，请重新选择",
                                "visual_storyboard_source",
                                422,
                            )
                if shot.previs and (old is None or shot.previs != old.previs):
                    stage = await self.session.get(VisualPrevisScene, shot.previs.scene_id)
                    if stage is None or stage.project_id != project_id:
                        raise ProjectResourceError(
                            "预演场景不属于当前项目", "visual_storyboard_reference", 422
                        )
                    if stage.revision != shot.previs.stage_revision:
                        raise ProjectResourceError(
                            "共享舞台已更新，请重新打开预演并核对",
                            "visual_previs_stage_conflict",
                            409,
                        )
                    if shot.previs.camera_id and shot.previs.camera_id not in {
                        camera.get("id") for camera in stage.document.get("cameras", [])
                    }:
                        # New per-shot cameras are part of the shot, not shared geometry.
                        if shot.previs.camera_id not in {
                            camera.get("id") for camera in shot.previs.overrides.get("cameras", [])
                        }:
                            raise ProjectResourceError(
                                "预演机位不存在", "visual_storyboard_reference", 422
                            )
                    if {obj["id"] for obj in shot.previs.overrides.get("objects", [])} - {
                        obj.get("id") for obj in stage.document.get("objects", [])
                    }:
                        raise ProjectResourceError(
                            "镜头覆盖引用的舞台对象不存在", "visual_storyboard_reference", 422
                        )
                for identity in set(shot.card_ids) - set(old.card_ids if old else []):
                    card = await self.session.get(VisualAssetCard, identity)
                    if (
                        identity not in project_cards
                        or card is None
                        or card.owner_user_id != self.owner
                    ):
                        raise ProjectResourceError(
                            "请先将设定卡加入当前项目", "visual_storyboard_reference", 422
                        )
            row = await self.session.get(VisualStoryboard, project_id)
            shots = [shot.model_dump(mode="json") for shot in body.shots]
            revision = current.revision + 1
            if row is None:
                self.session.add(
                    VisualStoryboard(project_id=project_id, shots=shots, revision=revision)
                )
            else:
                row.shots, row.revision = shots, revision
            await self.session.commit()
            return StoryboardOut(shots=body.shots, revision=revision)
        except BaseException:
            await self.session.rollback()
            raise


def _excerpt(value, start, end):
    # Browser textarea offsets count UTF-16 code units, including surrogate pairs.
    try:
        return value.encode("utf-16-le")[start * 2 : end * 2].decode("utf-16-le")
    except UnicodeError:
        return None
