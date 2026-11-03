"""Revalidate narrow community grants against Identity and Thought for each read."""

import httpx
from fastapi import HTTPException


class CommunityAssetChecks:
    def __init__(
        self,
        *,
        identity_credential,
        thought_credential,
        identity_url="http://identity:8080",
        thought_url="http://thought:8080",
        transport=None,
    ):
        if (
            not isinstance(identity_credential, str)
            or len(identity_credential) < 32
            or not isinstance(thought_credential, str)
            or len(thought_credential) < 32
            or identity_credential == thought_credential
        ):
            raise ValueError("社区素材复核需要独立强凭据")
        self.identity_credential, self.thought_credential = identity_credential, thought_credential
        self.identity_url, self.thought_url = identity_url, thought_url
        self.client = httpx.AsyncClient(
            transport=transport, trust_env=False, follow_redirects=False, timeout=3
        )

    async def verify(self, authority):
        try:
            identity = await self.client.post(
                self.identity_url + "/_internal/v1/thought-community-assets/check",
                headers={"Authorization": "Bearer " + self.identity_credential},
                json={"authority": authority},
            )
            if identity.status_code in {401, 403}:
                return False
            if identity.status_code != 200 or type(identity.json().get("active")) is not bool:
                raise ValueError("invalid identity check")
            if identity.json()["active"] is not True:
                return False
            source = await self.client.post(
                self.thought_url + "/_internal/v1/community-evidence/verify",
                headers={"Authorization": "Bearer " + self.thought_credential},
                json={"authority": authority},
            )
            if source.status_code != 200 or type(source.json().get("valid")) is not bool:
                raise ValueError("invalid source check")
            return source.json()["valid"]
        except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
            raise HTTPException(503, "community_asset_verification_unavailable") from exc

    async def close(self):
        await self.client.aclose()
