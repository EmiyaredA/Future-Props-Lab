"""Source applications persist authority + local intent before sending preparation.

The source saves its mutation and outcome receipt atomically. Only that durable
outcome decides commit/abort. A timeout never triggers abort or a new request ID.
"""

import httpx

from .capability_client import CapabilityDenied, CapabilityUnavailable
from .retention_authority import RetentionRequest


class RetentionClient:
    def __init__(
        self,
        *,
        service,
        credential,
        transport=None,
        identity_url="http://identity:8080",
        assets_url="http://assets:8080",
    ):
        self.service, self.credential = service, credential
        self.identity_url, self.assets_url = identity_url, assets_url
        self.client = httpx.AsyncClient(
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=10,
        )

    async def _request(self, method, url, *, token, body=None):
        try:
            response = await self.client.request(
                method,
                url,
                headers={"Authorization": "Bearer " + token},
                json=body,
            )
            if response.status_code in {401, 403, 404, 409, 422}:
                raise CapabilityDenied(response.status_code)
            if response.status_code != 200:
                raise CapabilityUnavailable("素材引用服务暂不可用")
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError("invalid reference acknowledgement")
            return result
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise CapabilityUnavailable("素材引用结果未确认，请保留原请求恢复") from exc

    async def authorize(self, *, assertion, source_method, source_path, change):
        body = RetentionRequest(
            caller=self.service,
            source_method=source_method,
            source_path=source_path,
            assertion=assertion,
            change=change,
        )
        result = await self._request(
            "POST",
            self.identity_url + "/_internal/v1/asset-retention/authorize",
            token=self.credential,
            body=body.model_dump(mode="json"),
        )
        token = result.get("authority")
        if not isinstance(token, str) or not 1 <= len(token) <= 16384:
            raise CapabilityUnavailable("素材引用授权响应无效")
        return token

    async def prepare(self, *, authority, change):
        return await self._request(
            "POST",
            self.assets_url + "/_internal/v1/retention/prepare",
            token=authority,
            body=change.model_dump(mode="json"),
        )

    async def status(self, *, authority, intent_id):
        return await self._outcome("GET", authority, intent_id, "")

    async def commit(self, *, authority, intent_id, resource_revision, deleted=False):
        return await self._outcome(
            "POST",
            authority,
            intent_id,
            "/commit",
            {"resource_revision": resource_revision, "deleted": deleted},
        )

    async def abort(self, *, authority, intent_id):
        return await self._outcome("POST", authority, intent_id, "/abort")

    async def _outcome(self, method, authority, intent_id, suffix, body=None):
        import re

        if not isinstance(intent_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", intent_id):
            raise ValueError("引用意图 ID 无效")
        return await self._request(
            method,
            self.assets_url + "/_internal/v1/retention/intents/" + intent_id + suffix,
            token=authority,
            body=body,
        )

    async def close(self):
        await self.client.aclose()
