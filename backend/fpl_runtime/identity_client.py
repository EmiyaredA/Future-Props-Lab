"""Long-lived operations revalidate their original assertion against Identity."""

import httpx


class LiveAuthorization:
    def __init__(self, *, service, credential, base_url="http://identity:8080", transport=None):
        self.service = service
        self.client = httpx.AsyncClient(
            base_url=base_url,
            trust_env=False,
            transport=transport,
            timeout=3,
            headers={"Authorization": "Bearer " + credential},
        )

    async def active(self, *, assertion, method, path):
        try:
            response = await self.client.post(
                "/_internal/v1/authorization/live",
                json={
                    "service": self.service,
                    "assertion": assertion,
                    "method": method,
                    "path": path,
                },
            )
        except httpx.HTTPError:
            return False
        if response.status_code != 200:
            return False
        try:
            return response.json().get("active") is True
        except (ValueError, AttributeError):
            return False

    async def close(self):
        await self.client.aclose()
