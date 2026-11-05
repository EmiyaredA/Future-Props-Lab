"""Bounded private event transport and replayable catalogue initialization lifecycle."""

import httpx

from studio.contracts.model_service.catalog_events import (
    CatalogAcknowledgment,
    CatalogEvent,
    CatalogEvents,
)
from studio.runtime.tasks.polling import PollingTaskRunner


class CatalogEventTransportError(RuntimeError):
    pass


class CatalogEventClient:
    def __init__(self, *, credential, base_url="http://identity:8080", transport=None):
        if (
            not isinstance(credential, str)
            or len(credential) < 32
            or not credential.isascii()
            or any(character.isspace() for character in credential)
        ):
            raise ValueError("Models 目录事件通道需要独立强凭据")
        self.client = httpx.AsyncClient(
            base_url=base_url,
            trust_env=False,
            follow_redirects=False,
            timeout=5,
            transport=transport,
            headers={"Authorization": "Bearer " + credential},
        )

    async def _request(self, method, path, **options):
        try:
            async with self.client.stream(method, path, **options) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    data.extend(chunk)
                    if len(data) > 131072:
                        raise CatalogEventTransportError("Identity 目录事件响应超过上限")
                return bytes(data)
        except httpx.HTTPError:
            raise CatalogEventTransportError("Identity 目录事件通道暂不可用") from None

    async def pending(self):
        data = await self._request("GET", "/_internal/v1/model-catalog/events")
        try:
            return CatalogEvents.model_validate_json(data).events
        except ValueError:
            raise CatalogEventTransportError("Identity 目录事件响应不符合协议") from None

    async def acknowledge(self, event: CatalogEvent):
        data = await self._request(
            "POST",
            f"/_internal/v1/model-catalog/events/{event.id}/ack",
            json={"revision": event.revision},
        )
        try:
            ack = CatalogAcknowledgment.model_validate_json(data)
            if ack.id != event.id or ack.revision != event.revision + 1:
                raise ValueError("acknowledgment mismatch")
        except ValueError:
            raise CatalogEventTransportError("Identity 目录事件回执不符合协议") from None

    async def close(self):
        await self.client.aclose()


class CatalogProvisioningRunner(PollingTaskRunner):
    runner_name = "model-catalog-provisioning"

    def __init__(self, *, client, provisioning):
        super().__init__()
        self.client, self.provisioning = client, provisioning

    async def recover(self):
        # Identity retains unacknowledged work; Models retains committed receipts.
        pass

    async def process_once(self):
        for delivery in await self.client.pending():
            await self.provisioning.apply(delivery)
            await self.client.acknowledge(delivery.event)
