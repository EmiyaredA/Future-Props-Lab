"""Build private installation batches from currently published Creative records."""

from dataclasses import dataclass
from uuid import uuid4

from app.console.creative_workshop.models import CreativeItem, CreativeRelease
from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeInstallPart

from .installation_outbox import InstallIntentConflict


@dataclass(frozen=True)
class ReleaseSnapshot:
    release_id: str
    kind: str
    title: str
    summary: str
    tags: list
    manifest: dict
    owner: str
    skill_path: str


async def published_parts(database, root_release_id):
    """Read publication metadata in a short session; callers recheck before commit."""
    async with database.sessions(info={"allow_system_reads": True}) as session:
        root = await session.get(CreativeRelease, root_release_id)
        item = await session.get(CreativeItem, root.item_id) if root else None
        if item is None or item.status != "published":
            raise InstallIntentConflict("公开能力版本不存在")
        ids = list(root.components) if item.kind == "bundle" else [root.id]
        if not ids or len(ids) > 50 or len(ids) != len(set(ids)):
            raise InstallIntentConflict("公开能力组合无效")
        result = []
        for release_id in ids:
            release = await session.get(CreativeRelease, release_id)
            component = await session.get(CreativeItem, release.item_id) if release else None
            if (
                component is None
                or component.status != "published"
                or component.kind not in {"tool_api", "mcp", "skill"}
            ):
                raise InstallIntentConflict("公开能力版本不可安装")
            result.append(
                ReleaseSnapshot(
                    release.id,
                    component.kind,
                    release.title,
                    release.summary,
                    list(release.tags),
                    dict(release.manifest),
                    component.origin_owner_user_id,
                    release.skill_path,
                )
            )
        return result


async def build_install_batch(database, packer, request: CreativeInstallPreviewIn):
    parts = []
    for release in await published_parts(database, request.release_id):
        description = None
        if release.kind == "skill":
            async with packer.open_release(
                release.owner, release.release_id, release.skill_path
            ) as (_, description):
                if description.file_count != release.manifest.get(
                    "file_count"
                ) or description.expanded_bytes != release.manifest.get("expanded_bytes"):
                    raise InstallIntentConflict("Skill 发布文件与版本描述不匹配")
        parts.append(
            CreativeInstallPart(
                release_id=release.release_id,
                kind=release.kind,
                title=release.title,
                target_name=request.names.get(release.release_id, release.title).strip(),
                summary=release.summary,
                tags=release.tags,
                manifest=release.manifest,
                skill=description,
            )
        )
    return CreativeInstallBatch(
        operation_id=str(uuid4()), root_release_id=request.release_id, parts=parts
    )
