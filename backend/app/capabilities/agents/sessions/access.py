"""Native I/O port used by the legacy monolith, outside workbench persistence."""

import asyncio

from .attachments import read_reference
from .catalog import candidates
from .locations import validate_location


class LocalSourceAccess:
    async def candidates(self, *, owner):
        self.require_owner(owner)
        return await asyncio.to_thread(candidates)

    async def location(self, body, *, owner):
        self.require_owner(owner)
        return await asyncio.to_thread(
            validate_location, agent_id=body.agent_id, root=body.root, endpoint=body.endpoint
        )

    async def attachment(self, roots, reference, *, owner):
        self.require_owner(owner)
        for root in roots:
            try:
                return await asyncio.to_thread(read_reference, root, reference)
            except (OSError, ValueError):
                continue
        raise ValueError("原生附件不在已授权来源范围内或已不可用")

    @staticmethod
    def require_owner(owner):
        if not isinstance(owner, str) or not owner:
            raise ValueError("缺少原生操作的账号上下文")
