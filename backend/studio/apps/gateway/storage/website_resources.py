"""Website adapter reads explicitly supplied resource models in an account-bound session."""


class WebsiteResources:
    def __init__(self, session, roots):
        self.session = session
        self.roots = roots

    async def exists(self, owner, kind, resource_id):
        row = await self.session.get(self.roots[kind], resource_id)
        return bool(row and row.owner_user_id == owner and not getattr(row, "deleted_at", None))
