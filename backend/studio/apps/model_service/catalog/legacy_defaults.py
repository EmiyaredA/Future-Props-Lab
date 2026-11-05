"""Original website storage only; independent Models supplies its own defaults adapter."""

from studio.apps.model_service.storage.website_settings import model_settings


class LegacyCatalogDefaults:
    def __init__(self, session):
        self.session = session

    def key(self, owner_user_id):
        if not owner_user_id or self.session.info.get("owner_user_id") != owner_user_id:
            raise ValueError("默认模型存储缺少匹配的账号上下文")
        return f"account_defaults:{owner_user_id}"

    async def read(self, *, owner_user_id):
        return (await model_settings(self.session).read(self.key(owner_user_id), {}))["value"]

    async def replace(self, *, owner_user_id, model_ids):
        key = self.key(owner_user_id)
        records = model_settings(self.session)
        current = await records.read(key, {})
        await records.replace(key, model_ids, expected_revision=current["revision"])
