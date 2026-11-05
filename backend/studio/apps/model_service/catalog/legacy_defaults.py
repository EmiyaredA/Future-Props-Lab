"""Original website storage only; independent Models supplies its own defaults adapter."""

from app.console.models.platform_governance import PlatformSetting


class LegacyCatalogDefaults:
    def __init__(self, session):
        self.session = session

    def key(self, owner_user_id):
        if not owner_user_id or self.session.info.get("owner_user_id") != owner_user_id:
            raise ValueError("默认模型存储缺少匹配的账号上下文")
        return f"account_defaults:{owner_user_id}"

    async def read(self, *, owner_user_id):
        row = await self.session.get(PlatformSetting, self.key(owner_user_id))
        return dict(row.payload) if row else {}

    async def replace(self, *, owner_user_id, model_ids):
        key = self.key(owner_user_id)
        row = await self.session.get(PlatformSetting, key)
        if row:
            row.payload = dict(model_ids)
            row.revision += 1
        else:
            self.session.add(PlatformSetting(id=key, payload=dict(model_ids), revision=1))
