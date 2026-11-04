"""Long-lived operations revalidate their original assertion against Identity."""

import httpx

from .cloud_authority import AUTHORITY_PATH, CloudAuthority, CloudAuthorityQuery


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

    async def status(self, *, assertion, method, path):
        return await self._status(self.service, assertion=assertion, method=method, path=path)

    async def motion_export_source_status(self, *, assertion, path):
        from .motion_exports import render_target

        if self.service != "assets" or not render_target("POST", path):
            return False
        return await self._status("rendering", assertion=assertion, method="POST", path=path)

    async def _status(self, service, *, assertion, method, path):
        try:
            response = await self.client.post(
                "/_internal/v1/authorization/live",
                json={
                    "service": service,
                    "assertion": assertion,
                    "method": method,
                    "path": path,
                },
            )
            if response.status_code != 200:
                return None
            result = response.json().get("active")
            return result if type(result) is bool else None
        except (httpx.HTTPError, ValueError, AttributeError):
            return None

    async def active(self, *, assertion, method, path):
        return await self.status(assertion=assertion, method=method, path=path) is True

    async def cloud_authority(self, *, assertion, method, path):
        query = CloudAuthorityQuery(
            service=self.service, assertion=assertion, method=method, path=path
        )
        try:
            response = await self.client.post(AUTHORITY_PATH, json=query.model_dump())
            if response.status_code == 200:
                return CloudAuthority.model_validate(response.json())
        except (httpx.HTTPError, ValueError):
            pass
        return None

    async def owner_permission(self, *, owner, permission):
        try:
            response = await self.client.post(
                "/_internal/v1/tasks/authorize",
                json={"service": self.service, "owner_user_id": owner, "permission": permission},
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("allowed") is False:
                    return {"allowed": False, "available": True, "revision": None}
                if (
                    data.get("allowed") is True
                    and type(data.get("revision")) is int
                    and data["revision"] >= 0
                ):
                    return {**data, "available": True}
        except (httpx.HTTPError, ValueError, AttributeError):
            pass
        return {"allowed": False, "available": False, "revision": None}

    async def can_prepare_retention(self, authority, *, sealed_visual_upload=False):
        if self.service != "assets":
            return False
        try:
            response = await self.client.post(
                "/_internal/v1/asset-retention/check",
                json={"authority": authority, "sealed_visual_upload": sealed_visual_upload},
            )
            if response.status_code != 200:
                return None
            result = response.json().get("active")
            return result if type(result) is bool else None
        except (httpx.HTTPError, ValueError, AttributeError):
            return None

    async def close(self):
        await self.client.aclose()
