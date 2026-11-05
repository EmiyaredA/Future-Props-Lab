"""Bounded target discovery, authorized by the original template operation."""

import time

import httpx
from pydantic import BaseModel, ConfigDict, Field


class DirectoryUnavailable(RuntimeError):
    pass


class Target(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    display_name: str = Field(max_length=255)
    revision: int = Field(ge=0)


class Targets(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active: bool
    expires_at: int
    targets: list[Target] = Field(max_length=1000)


class TemplateDirectory:
    def __init__(self, *, credential, base_url="http://identity:8080", transport=None):
        self.client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=5,
            headers={"Authorization": "Bearer " + credential},
        )

    async def targets(self, *, assertion, path, role, account_ids=None):
        try:
            async with self.client.stream(
                "POST",
                "/_internal/v1/model-governance/template-targets",
                json={
                    "assertion": assertion,
                    "path": path,
                    "role": role,
                    "account_ids": account_ids,
                },
            ) as response:
                response.raise_for_status()
                if response.status_code != 200:
                    raise DirectoryUnavailable("账号目标状态暂不可用")
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    data.extend(chunk)
                    if len(data) > 256 * 1024:
                        raise DirectoryUnavailable("账号目标响应超过上限")
            result = Targets.model_validate_json(data)
            if not time.time() < result.expires_at <= time.time() + 7:
                raise ValueError("expired Identity decision")
            return result
        except (httpx.HTTPError, ValueError, TypeError):
            raise DirectoryUnavailable("账号目标状态暂不可用") from None

    async def close(self):
        await self.client.aclose()
