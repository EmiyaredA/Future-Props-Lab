"""Recovery-site author adapter; independent Creative never imports Identity ORM."""

from app.console.models.accounts import User


class LegacyCreativeAuthors:
    def __init__(self, session):
        self.session = session

    async def name(self, *, item_id: str, author_id: str) -> str | None:
        del item_id  # Recovery DB already scopes item visibility in Creative.
        user = await self.session.get(User, author_id)
        return (user.display_name or user.username) if user else None
