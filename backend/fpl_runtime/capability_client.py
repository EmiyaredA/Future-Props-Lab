"""Explicit service requests exchange a verified source assertion for a narrow target token."""

from dataclasses import asdict

import httpx

from .delegation import RequestGrant, permitted


class CapabilityUnavailable(RuntimeError):
    pass


class CapabilityDenied(RuntimeError):
    def __init__(self, status):
        super().__init__("跨服务请求被拒绝")
        self.status = status


class CapabilityClient:
    def __init__(
        self, *, service, credential, catalog, transport=None, identity_url="http://identity:8080"
    ):
        self.service, self.catalog = service, catalog
        self.credential, self.identity_url = credential, identity_url
        self.client = httpx.AsyncClient(
            trust_env=False,
            follow_redirects=False,
            timeout=10,
            transport=transport,
        )

    async def resource_exists(self, *, assertion, target_service, target_path):
        grant = RequestGrant(
            self.service,
            "automation.resource.read",
            "POST",
            "/v1/automation/open",
            target_service,
            "GET",
            target_path,
        )
        return await self._exists(assertion, grant)

    async def project_exists(self, *, assertion, source_method, source_path, project_id):
        grant = RequestGrant(
            self.service,
            "assets.visual-project.read",
            source_method,
            source_path,
            "visual",
            "GET",
            "/v1/visual-workshop/projects/" + project_id,
        )
        return await self._exists(assertion, grant)

    async def _exists(self, assertion, grant):
        if not permitted(grant, self.catalog):
            raise CapabilityDenied(403)
        try:
            delegated = await self.client.post(
                self.identity_url + "/_internal/v1/authorization/delegate",
                headers={"Authorization": "Bearer " + self.credential},
                json={**asdict(grant), "assertion": assertion},
            )
            if delegated.status_code in {401, 403}:
                raise CapabilityDenied(delegated.status_code)
            delegated.raise_for_status()
            token = delegated.json()["assertion"]
            if not isinstance(token, str) or not 1 <= len(token) <= 8192:
                raise ValueError("invalid assertion")
            async with self.client.stream(
                "GET",
                f"http://{grant.target_service}:8080" + grant.target_path,
                headers={"X-Fpl-Context": token},
            ) as response:
                if response.status_code == 404:
                    return False
                if response.status_code in {401, 403}:
                    raise CapabilityDenied(response.status_code)
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError("unexpected resource status")
                return True
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("所属应用暂不可用，未确认资源归属") from exc

    async def close(self):
        await self.client.aclose()
