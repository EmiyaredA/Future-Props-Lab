"""Creative decisions over detached snapshots, without I/O or transaction control."""

from studio.apps.visual_workshop.creative_assets import MODEL_MIME
from studio.apps.visual_workshop.creative_ports import CardWrite
from studio.apps.visual_workshop.schemas.creative_workflow import CardData
from studio.runtime.project_errors import ProjectResourceError


def check_source(script, source):
    if source is not None and (
        script.revision != source.revision
        or not any(
            scene.id == source.scene_id for episode in script.episodes for scene in episode.scenes
        )
    ):
        raise ProjectResourceError("来源剧本已经变化，请重新读取", "visual_script_conflict", 409)


def validate_card(project_id, data, previous, parent, script):
    parent_id = data.parent_id
    inherited_source = False
    if previous is not None and (
        previous.kind != data.kind
        or previous.parent_id != parent_id
        or previous.parent_asset_id != data.parent_asset_id
    ):
        raise ProjectResourceError("卡片类型和父版本在创建后固定", "visual_card_parent", 422)
    if parent_id and previous is None:
        if parent is None:
            raise ProjectResourceError("设定卡不存在")
        if (
            parent.kind != data.kind
            or parent.archived
            or not parent.adopted_asset_id
            or parent.adopted_asset_id != data.parent_asset_id
        ):
            raise ProjectResourceError("请选择已有采用图的同类父卡", "visual_card_parent", 422)
        inherited_source = parent.source == data.source
    if not inherited_source and (previous is None or previous.source != data.source):
        if data.source is not None and project_id is None:
            raise ProjectResourceError("请从来源项目的剧本提取设定", "visual_card_source", 422)
        check_source(script, data.source)
    if data.parent_asset_id and not parent_id:
        raise ProjectResourceError("父图需要关联父卡", "visual_card_parent", 422)
    old_tasks = set(previous.candidate_task_ids if previous else [])
    if set(data.candidate_task_ids) != old_tasks:
        raise ProjectResourceError("候选任务须通过设定卡生成", "visual_card_reference", 422)


def prepare_card(
    project_id, data, identities, images, models, audio, found, context, *, inherit_voice=False
):
    previous, parent = context.previous, context.parent
    validate_card(project_id, data, previous, parent, context.script)
    if inherit_voice and parent and parent.voice_asset_id != data.voice_asset_id:
        raise ProjectResourceError("父卡语音已更新，请重新创建变体", "visual_card_conflict", 409)
    previous_media = previous.media_projects if previous else {}
    media = {}
    for identity in identities:
        item = found.get(identity)
        if item is not None:
            if (
                (identity not in images or item.media_kind == "image")
                and (identity not in models or item.mime_type == MODEL_MIME)
                and (identity not in audio or item.media_kind == "audio")
            ):
                media[identity] = item.project_id
                continue
        elif identity in previous_media:
            media[identity] = previous_media[identity]
            continue
        raise ProjectResourceError(
            "素材已删除、类型不符或不属于当前账号", "visual_asset_scope", 422
        )
    source_project = previous.source_project_id if previous else None
    if data.source and (previous is None or previous.source != data.source):
        source_project = (
            parent.source_project_id
            if data.parent_id and previous is None and parent and parent.source == data.source
            else project_id
        )
    if not data.source:
        source_project = None
    return CardWrite(
        CardData.model_validate(data.model_dump(exclude={"expected_revision"})),
        source_project,
        media,
    )


def validate_card_generation(card, expected_revision):
    if card.revision != expected_revision or card.archived:
        raise ProjectResourceError("设定卡已更新，请保存后重试", "visual_card_conflict", 409)
    if len(card.candidate_task_ids) >= 80:
        raise ProjectResourceError("设定卡最多保留 80 个生成任务", "visual_card_task_limit", 409)
