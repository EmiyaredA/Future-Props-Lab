"""Script and card use cases; storage and asset access are replaceable ports."""

from functools import partial

from studio.apps.visual_workshop.creative_assets import model_id
from studio.apps.visual_workshop.creative_ports import CreativeAssets, CreativeRecords
from studio.apps.visual_workshop.creative_rules import check_source, prepare_card
from studio.runtime.project_errors import ProjectResourceError


class CreativeWorkflow:
    def __init__(self, store: CreativeRecords, inspect_assets: CreativeAssets | None = None):
        self.store, self.inspect_assets = store, inspect_assets

    async def script(self, project_id):
        return await self.store.script(project_id)

    async def update_script(self, project_id, body):
        return await self.store.update_script(project_id, body)

    async def check_source(self, project_id, source):
        if source is not None:
            check_source(await self.store.script(project_id), source)

    async def cards(self, project_id=None):
        return await self.store.cards(project_id)

    async def card(self, project_id, card_id):
        return await self.store.card(project_id, card_id)

    async def save_card(self, project_id, data, card_id=None):
        # Authorize before asset inspection, and copy the parent's voice only on
        # creation. An explicitly supplied null means an independent silent card.
        if project_id is not None:
            await self.store.require_project(project_id)
        if card_id:
            await self.store.card(project_id, card_id)
        inherit_voice = (
            not card_id and data.parent_id and "voice_asset_id" not in data.model_fields_set
        )
        if inherit_voice:
            parent = await self.store.card(None, data.parent_id)
            data = data.model_copy(update={"voice_asset_id": parent.voice_asset_id})
        images = set(
            filter(None, [data.adopted_asset_id, data.parent_asset_id, *data.candidate_asset_ids])
        )
        models = set()
        if data.model_asset_key:
            identity = model_id(data.model_asset_key)
            if identity is None:
                raise ProjectResourceError("3D 模型标识无效", "visual_asset_scope", 422)
            models.add(identity)
        audio = {data.voice_asset_id} if data.voice_asset_id else set()
        identities = images | models | audio
        if identities and self.inspect_assets is None:
            raise ProjectResourceError("设定素材校验未配置", "visual_asset_scope_unavailable", 503)
        found = await self.inspect_assets(None, identities) if identities else {}
        return await self.store.edit_card(
            project_id,
            data,
            card_id,
            partial(
                prepare_card,
                project_id,
                data,
                identities,
                images,
                models,
                audio,
                found,
                inherit_voice=bool(inherit_voice),
            ),
        )
