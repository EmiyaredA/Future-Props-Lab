"""Transport exact archive file and manifest bytes over scoped Assets requests."""

import hashlib
import secrets
from dataclasses import dataclass

import httpx
from anyio import open_file

from studio.contracts.asset_library.descriptions import LibraryAssetDescription
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.thought_workshop.thought_archives import ArchiveAuthenticator
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


class ArchiveTransport:
    def __init__(
        self,
        capabilities,
        key,
        *,
        service,
        purpose,
        source_path,
        prefix,
        domain,
        asset_model,
        exact_mime=True,
    ):
        self.capabilities = capabilities
        self.auth = ArchiveAuthenticator(key, domain=domain)
        self.service, self.purpose, self.source_path = service, purpose, source_path
        self.prefix, self.asset_model = prefix, asset_model
        self.exact_mime = exact_mime

    async def _send(self, path, owner, body, *, assertion=None, descriptor=None):
        nonce = secrets.token_hex(16)
        headers = {"X-Fpl-Archive-Nonce": nonce}
        if descriptor is not None:
            headers["X-Fpl-Upload-Descriptor"] = descriptor.header()
            headers["Content-Length"] = str(descriptor.byte_size)
        if assertion is not None:
            grant = RequestGrant(
                self.service, self.purpose, "POST", self.source_path, "assets", "POST", path
            )
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
            raise CapabilityUnavailable("归档结果尚未确认") from exc

    async def stage(self, owner, key, ordinal, description, body, assertion):
        path = (
            f"{self.prefix}/{key.batch_id}/{key.source_sha256}/files/"
            f"{ordinal}/{description.fingerprint}"
        )
        data = await self._send(path, owner, body, assertion=assertion, descriptor=description)
        try:
            asset = self.asset_model.model_validate_json(data)
            if asset.revision != 0 or (
                self.exact_mime and asset.mime_type != description.mime_type
            ):
                raise ValueError("staged file descriptor changed")
            return asset
        except ValueError as exc:
            raise CapabilityUnavailable("归档文件回执无效") from exc

    async def seal(self, owner, key, manifest, assertion):
        path = f"{self.prefix}/{key.batch_id}/{key.source_sha256}/seal/{manifest.fingerprint}"
        data = await self._send(
            path, owner, manifest.model_dump_json().encode(), assertion=assertion
        )
        if data != b'{"state":"sealed"}':
            raise CapabilityUnavailable("归档未确认封存")

    async def settle(self, outcome):
        data = await self._send(
            self.prefix + "/settle", outcome.owner, outcome.model_dump_json().encode()
        )
        expected = (
            b'{"state":"published"}' if outcome.decision == "commit" else b'{"state":"aborted"}'
        )
        if data != expected:
            raise CapabilityUnavailable("归档决议未确认")


@dataclass(frozen=True)
class SnapshotFileDescription(ModelOutputDescription):
    display_name: str

    def __post_init__(self):
        super().__post_init__()
        if not isinstance(self.display_name, str) or not 1 <= len(self.display_name) <= 255:
            raise ValueError("归档素材名称无效")


class HashingUpload:
    def __init__(self, incoming):
        self.incoming = incoming
        self.digest = hashlib.sha256()

    async def read(self, size):
        data = await self.incoming.read(size)
        self.digest.update(data)
        return data

    async def close(self):
        await self.incoming.close()


async def chunks(path):
    async with await open_file(path, "rb") as file:
        while data := await file.read(1024 * 1024):
            yield data


class SnapshotArchiveAsset(LibraryAssetDescription):
    display_name: str
