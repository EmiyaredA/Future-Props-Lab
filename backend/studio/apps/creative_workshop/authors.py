"""Resolve display names using a Creative request and an independently authenticated peer."""

import httpx

from studio.contracts.creative_workshop.creative_authors import (
    PATH,
    CreativeAuthorName,
    CreativeAuthorQuery,
)
from studio.contracts.creative_workshop.errors import CreativeError


class HttpCreativeAuthors:
    def __init__(
        self,
        *,
        assertion,
        method,
        path,
        credential,
        identity_url="http://identity:8080",
        transport=None,
    ):
        self.assertion, self.method, self.path = assertion, method, path
        self.credential, self.identity_url, self.transport = credential, identity_url, transport
        self.names = {}

    async def name(self, *, item_id: str, author_id: str) -> str | None:
        if author_id in self.names:
            return self.names[author_id]
        try:
            query = CreativeAuthorQuery(
                assertion=self.assertion,
                source_method=self.method,
                source_path=self.path,
                item_id=item_id,
                author_id=author_id,
            )
            async with httpx.AsyncClient(
                transport=self.transport,
                trust_env=False,
                follow_redirects=False,
                timeout=3,
            ) as client:
                result = await client.post(
                    self.identity_url + PATH,
                    headers={"Authorization": "Bearer " + self.credential},
                    json=query.model_dump(),
                )
            if result.status_code in {401, 403}:
                raise CreativeError(
                    "创作作者查询授权已失效", result.status_code, "creative_author_denied"
                )
            if result.status_code != 200 or len(result.content) > 4096:
                raise ValueError("invalid Creative author response")
            name = CreativeAuthorName.model_validate_json(result.content).name
        except (httpx.HTTPError, ValueError, TypeError):
            raise CreativeError(
                "创作作者目录暂不可用", 503, "creative_authors_unavailable"
            ) from None
        self.names[author_id] = name
        return name
