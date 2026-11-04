"""Transport exact presentation file and manifest bytes over scoped Assets requests."""

import secrets

import httpx

from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.presentation_archives import DOMAIN, IMPORT, PREFIX, PURPOSE, SETTLE
from fpl_runtime.presentation_assets import PresentationAsset
from fpl_runtime.thought_archives import ArchiveAuthenticator


class ArchiveTransport:
    def __init__(self, capabilities, key):
        self.capabilities = capabilities
        self.auth = ArchiveAuthenticator(key, domain=DOMAIN)

    async def _send(self, path, owner, body, *, assertion=None, descriptor=None):
        nonce = secrets.token_hex(16)
        headers = {"X-Fpl-Archive-Nonce": nonce}
        if descriptor is not None:
            headers["X-Fpl-Upload-Descriptor"] = descriptor.header()
        if assertion is not None:
            grant = RequestGrant("presentation", PURPOSE, "POST", IMPORT, "assets", "POST", path)
            headers[HEADER] = await self.capabilities.authorize_request(assertion, grant)
        else:
            headers["X-Fpl-Archive-Decision"] = self.auth.sign(
                "decision", path=path, owner=owner, nonce=nonce, body=body
            )
        try:
            async with self.capabilities.client.stream(
                "POST",
                "http://assets:8080" + path,
                headers=headers,
                content=body,
                timeout=httpx.Timeout(120, connect=5),
            ) as response:
                if response.status_code in {401, 403, 404, 409, 413, 422}:
                    raise CapabilityDenied(response.status_code)
                response.raise_for_status()
                result = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(result) + len(chunk) > 16 * 1024:
                        raise ValueError("oversized archive receipt")
                    result.extend(chunk)
                self.auth.verify(
                    response.headers.get("X-Fpl-Archive-Receipt", ""),
                    "receipt",
                    path=path,
                    owner=owner,
                    nonce=nonce,
                    body=result,
                )
                return bytes(result)
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("演示归档结果尚未确认") from exc

    async def stage(self, owner, key, ordinal, description, body, assertion):
        path = (
            f"{PREFIX}/{key.batch_id}/{key.source_sha256}/files/{ordinal}/{description.fingerprint}"
        )
        data = await self._send(path, owner, body, assertion=assertion, descriptor=description)
        try:
            asset = PresentationAsset.model_validate_json(data)
            if asset.revision != 0 or asset.mime_type != description.mime_type:
                raise ValueError("staged file descriptor changed")
            return asset
        except ValueError as exc:
            raise CapabilityUnavailable("演示归档文件回执无效") from exc

    async def seal(self, owner, key, manifest, assertion):
        path = f"{PREFIX}/{key.batch_id}/{key.source_sha256}/seal/{manifest.fingerprint}"
        data = await self._send(
            path, owner, manifest.model_dump_json().encode(), assertion=assertion
        )
        if data != b'{"state":"sealed"}':
            raise CapabilityUnavailable("演示归档未确认封存")

    async def settle(self, outcome):
        data = await self._send(SETTLE, outcome.owner, outcome.model_dump_json().encode())
        expected = (
            b'{"state":"published"}' if outcome.decision == "commit" else b'{"state":"aborted"}'
        )
        if data != expected:
            raise CapabilityUnavailable("演示归档决议未确认")
