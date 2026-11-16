"""Website adapter reads explicitly supplied resource models in an account-bound session."""


class WebsiteResources:
    def __init__(self, session, roots):
        self.session = session
        self.roots = roots

    async def exists(self, owner, kind, resource_id):
        model = self.roots.get(kind)
        if model is None:
            # Standalone-only resources have no table in the compatibility website.
            return False
        row = await self.session.get(model, resource_id)
        return bool(row and row.owner_user_id == owner and not getattr(row, "deleted_at", None))
