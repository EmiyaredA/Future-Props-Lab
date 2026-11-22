"""Freeze and remap the project script and design library in portable snapshots."""

from studio.apps.visual_workshop.creation_links.models import VisualCreationLinks
from studio.apps.visual_workshop.creative_assets import model_id, model_path
from studio.apps.visual_workshop.previs_scenes import scene_rows
from studio.apps.visual_workshop.schemas.creative_workflow import (
    CardOut,
    ScriptOut,
    current_card_data,
)
from studio.apps.visual_workshop.storage.models import (
    VisualAssetCard,
    VisualScript,
)
from studio.apps.visual_workshop.storyboard.snapshots import export_storyboard
from studio.runtime.files.project_archives import ProjectSnapshotError
from studio.runtime.ids import new_id


async def export_creative_workflow(session, project_id):
    script = await session.get(VisualScript, project_id)
    links = await session.get(VisualCreationLinks, project_id)
    return {
        "previs_scene_ids": [row.id for row in await scene_rows(session, project_id)],
        "creation_links": {
            "scenes": links.scenes,
            "objects": links.objects,
            "revision": links.revision,
        }
        if links
        else None,
        "script": {"episodes": script.episodes, "revision": script.revision} if script else None,
        "storyboard": await export_storyboard(session, project_id),
    }


def card_image_ids(card):
    return set(
        filter(None, [card.adopted_asset_id, card.parent_asset_id, *card.candidate_asset_ids])
    )


def import_creative_workflow(payload, owner, project_id, asset_ids):
    try:
        raw = payload.get("asset_cards", [])
        if not isinstance(raw, list) or len(raw) > 500:
            raise ValueError("设定卡数量无效")
        cards = [CardOut.model_validate(current_card_data(item)) for item in raw]
        identities = {card.id: new_id() for card in cards}
        by_id = {card.id: card for card in cards}
        if len(identities) != len(cards):
            raise ValueError("设定卡标识重复")
        script = (
            ScriptOut.model_validate(payload["script"])
            if payload.get("script") is not None
            else None
        )
        rows = [VisualScript(project_id=project_id, **script.model_dump())] if script else []
        for card in cards:
            parent = by_id.get(card.parent_id)
            if card.parent_id and (
                not parent or parent.kind != card.kind or not card.parent_asset_id
            ):
                raise ValueError("设定卡缺少有效父卡")
            visited = {card.id}
            while parent:
                if parent.id in visited:
                    raise ValueError("设定卡父级循环")
                visited.add(parent.id)
                parent = by_id.get(parent.parent_id)
            data = card.model_dump(
                exclude={"id", "revision", "source_project_id", "media_projects"}
            )
            data["parent_id"] = identities.get(card.parent_id)
            data["candidate_task_ids"] = []
            data["candidate_asset_ids"] = [asset_ids[key] for key in card.candidate_asset_ids]
            for name in ("adopted_asset_id", "parent_asset_id", "voice_asset_id"):
                if data[name]:
                    data[name] = asset_ids[data[name]]
            if card.model_asset_key:
                model = model_id(card.model_asset_key)
                if not model:
                    raise ValueError("设定卡的模型引用无效")
                data["model_asset_key"] = model_path(asset_ids[model])
            rows.append(
                VisualAssetCard(
                    id=identities[card.id],
                    owner_user_id=owner,
                    project_id=project_id if card.source else None,
                    revision=0,
                    data=data,
                    media_projects={
                        **{asset_ids[key]: project_id for key in card_image_ids(card)},
                        **(
                            {asset_ids[card.voice_asset_id]: project_id}
                            if card.voice_asset_id
                            else {}
                        ),
                        **({asset_ids[model]: project_id} if card.model_asset_key else {}),
                    },
                )
            )
        return (
            rows,
            {
                **{asset_ids[key]: "image" for card in cards for key in card_image_ids(card)},
                **{
                    asset_ids[card.voice_asset_id]: "audio" for card in cards if card.voice_asset_id
                },
            },
            {asset_ids[key] for card in cards if (key := model_id(card.model_asset_key))},
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ProjectSnapshotError("剧本或设定卡快照结构无效") from exc
