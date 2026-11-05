"""Default model selections share the catalog's short CAS write transaction."""

from .models import AccountDefaults


class OwnedCatalogDefaults:
    def __init__(self, session):
        self.session = session

    def require_owner(self, owner_user_id):
        if not owner_user_id or self.session.info.get("owner_user_id") != owner_user_id:
            raise ValueError("默认模型存储缺少匹配的账号上下文")

    async def read(self, *, owner_user_id):
        self.require_owner(owner_user_id)
        row = await self.session.get(AccountDefaults, owner_user_id)
        return dict(row.model_ids) if row else {}

    async def replace(self, *, owner_user_id, model_ids):
        self.require_owner(owner_user_id)
        row = await self.session.get(AccountDefaults, owner_user_id)
        if row:
            row.model_ids = dict(model_ids)
            row.revision += 1
        else:
            self.session.add(
                AccountDefaults(
                    owner_user_id=owner_user_id,
                    model_ids=dict(model_ids),
                    revision=1,
                )
            )
