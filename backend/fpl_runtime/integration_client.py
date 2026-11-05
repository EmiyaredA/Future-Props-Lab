"""Bounded enrollment and live checks for fixed integration intent scopes."""

import time

import httpx

from .external_sync import ExternalIntentGrant
from .integration_intents import (
    AmadeusToolGrant,
    DemoInstallGrant,
    IntegrationCapacityGrant,
    IntegrationDecision,
    IntegrationGrantReceipt,
    IntegrationIntentCheck,
    IntegrationIntentInput,
    IntegrationIntentReceipt,
)


class IntegrationAuthorizationUnavailable(RuntimeError):
    pass


class IntegrationIntentClient:
    def __init__(self, *, service, credential, base_url="http://identity:8080", transport=None):
        if (
            service not in {"integrations", "thought", "models", "amadeus"}
            or not isinstance(credential, str)
            or not 32 <= len(credential) <= 512
            or any(not 32 < ord(character) < 127 for character in credential)
        ):
            raise ValueError("集成任务需要独立服务连接")
        self.service = service
        self.client = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            timeout=5,
            headers={"Authorization": "Bearer " + credential},
        )

    async def request(self, path, body, response_type):
        try:
            async with self.client.stream(
                "POST",
                "/_internal/v1/integration-intents" + path,
                json=body.model_dump(mode="json"),
            ) as response:
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError("intent status")
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=16384):
                    data.extend(chunk)
                    if len(data) > 65536:
                        raise ValueError("intent response size")
            return response_type.model_validate_json(data)
        except (httpx.HTTPError, ValueError, TypeError):
            raise IntegrationAuthorizationUnavailable("集成任务授权暂不可用") from None

    async def enroll(self, *, request_id, assertion, method, path, scope):
        body = IntegrationIntentInput(
            caller=self.service,
            request_id=request_id,
            assertion=assertion,
            source_method=method,
            source_path=path,
            scope=scope,
        )
        receipt = await self.request("", body, IntegrationIntentReceipt)
        if receipt.scope != scope:
            raise IntegrationAuthorizationUnavailable("集成任务授权范围不符")
        return receipt

    async def check(self, intent_id):
        body = IntegrationIntentCheck(service=self.service, intent_id=intent_id)
        result = await self.request("/check", body, IntegrationDecision)
        if not time.time() < result.expires_at <= time.time() + 7:
            raise IntegrationAuthorizationUnavailable("集成任务授权决定已过期")
        return result

    async def capacity_grant(self, intent_id, operation):
        value = await self.request(
            "/capacity-grant",
            IntegrationCapacityGrant(intent_id=intent_id, operation=operation),
            IntegrationGrantReceipt,
        )
        return value.assertion

    async def external_grant(self, body: ExternalIntentGrant):
        value = await self.request("/external-grant", body, IntegrationGrantReceipt)
        return value.assertion

    async def amadeus_tool_grant(self, intent_id):
        value = await self.request(
            "/amadeus-tool-grant", AmadeusToolGrant(intent_id=intent_id), IntegrationGrantReceipt
        )
        return value.assertion

    async def demo_install_grant(self, intent_id, operation):
        value = await self.request(
            "/demo-install-grant",
            DemoInstallGrant(intent_id=intent_id, operation=operation),
            IntegrationGrantReceipt,
        )
        return value.assertion

    async def close(self):
        await self.client.aclose()
