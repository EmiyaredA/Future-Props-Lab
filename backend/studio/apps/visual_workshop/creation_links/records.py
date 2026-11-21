"""Owner-scoped link validation and short CAS transactions."""

from sqlalchemy import text

from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.storage.models import VisualAssetCard, VisualPrevisScene
from studio.runtime.project_errors import ProjectResourceError

from .models import VisualCreationLinks
from .schemas import CreationLinksOut


class CreationLinkRecords:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.projects = Projects(session, owner)

    async def get(self, project_id):
        await self.projects.row(project_id)
        row = await self.session.get(VisualCreationLinks, project_id, populate_existing=True)
        return (
            CreationLinksOut(scenes=row.scenes, objects=row.objects, revision=row.revision)
            if row
            else CreationLinksOut(revision=0)
        )

    async def save(self, project_id, body):
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            current = await self.get(project_id)
            if current.revision != body.expected_revision:
                raise ProjectResourceError(
                    "场景绑定已更新，本地修改仍保留，请重新读取",
                    "visual_creation_links_conflict",
                    409,
                )
            canvas = await self.projects.canvas_row(project_id)
            previous = {("scene", row.card_id, row.previs_scene_id) for row in current.scenes}
            previous |= {
                ("object", row.previs_scene_id, row.object_id, row.card_id)
                for row in current.objects
            }
            for binding in [*body.scenes, *body.objects]:
                is_scene = hasattr(binding, "object_id") is False
                key = (
                    ("scene", binding.card_id, binding.previs_scene_id)
                    if is_scene
                    else ("object", binding.previs_scene_id, binding.object_id, binding.card_id)
                )
                if key in previous:
                    continue  # Retain broken historical links until explicitly repaired.
                card = await self.session.get(VisualAssetCard, binding.card_id)
                scene = await self.session.get(VisualPrevisScene, binding.previs_scene_id)
                if (
                    card is None
                    or card.owner_user_id != self.owner
                    or card.id not in (canvas.project_card_ids or [])
                ):
                    raise ProjectResourceError(
                        "请先将设定卡加入当前项目", "visual_creation_link_reference", 422
                    )
                if scene is None or scene.project_id != project_id:
                    raise ProjectResourceError(
                        "3D场景不属于当前项目", "visual_creation_link_reference", 422
                    )
                kind = card.data.get("kind")
                if (is_scene and kind != "scene") or (
                    not is_scene and kind not in {"character", "prop"}
                ):
                    raise ProjectResourceError(
                        "设定卡类型与绑定用途不符", "visual_creation_link_reference", 422
                    )
                if not is_scene and binding.object_id not in {
                    obj.get("id") for obj in scene.document.get("objects", [])
                }:
                    raise ProjectResourceError(
                        "白模对象不存在", "visual_creation_link_reference", 422
                    )
            data = body.model_dump(mode="json", exclude={"expected_revision"})
            row = await self.session.get(VisualCreationLinks, project_id)
            revision = current.revision + 1
            if row is None:
                self.session.add(
                    VisualCreationLinks(project_id=project_id, revision=revision, **data)
                )
            else:
                row.scenes, row.objects, row.revision = data["scenes"], data["objects"], revision
            await self.session.commit()
            return CreationLinksOut(**data, revision=revision)
        except BaseException:
            await self.session.rollback()
            raise
