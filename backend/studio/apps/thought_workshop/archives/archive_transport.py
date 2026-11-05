"""Stream staged files and authenticate exact Assets batch receipts."""

import base64
import os
import secrets
import stat

import httpx
from anyio.to_thread import run_sync

from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.thought_workshop.community_uploads import PURPOSE as COMMUNITY_PURPOSE
from studio.contracts.thought_workshop.community_uploads import public_path
from studio.contracts.thought_workshop.thought_archives import (
    IMPORT_PATH,
    PREFIX,
    PURPOSE,
    SETTLE_PATH,
    ArchiveAuthenticator,
    ArchiveFileKey,
    ArchiveManifest,
)
from studio.contracts.thought_workshop.thought_assets import AssetDescription
from studio.runtime.http.capability_client import (
    CapabilityClient,
    CapabilityDenied,
    CapabilityUnavailable,
)


class ArchiveTransport:
    def __init__(self, *, credential, peer_key, catalog, transport=None):
        self.capabilities = CapabilityClient(
            service="thought", credential=credential, catalog=catalog, transport=transport
        )
        self.auth = ArchiveAuthenticator(peer_key)

    async def close(self):
        await self.capabilities.close()

    async def _send(
        self,
        path,
        owner,
        *,
        assertion=None,
        decision=None,
        headers=None,
        content,
        community=None,
    ):
        nonce = secrets.token_hex(16)
        headers = {**(headers or {}), "X-Fpl-Archive-Nonce": nonce}
        if decision:
            headers["X-Fpl-Archive-Decision"] = self.auth.sign(
                "decision", path=path, owner=owner, nonce=nonce, body=content
            )
        else:
            if community is not None:
                context = community.model_dump_json().encode()
                headers["X-Fpl-Community-Upload-Context"] = base64.b64encode(context).decode()
                headers["X-Fpl-Community-Upload-Proof"] = self.auth.sign(
                    "community-stage", path=path, owner=owner, nonce=nonce, body=context
                )
                source = public_path(community.publication_id, community.note_id)
                grant = RequestGrant(
                    "thought", COMMUNITY_PURPOSE, "POST", source, "assets", "POST", path
                )
            else:
                grant = RequestGrant(
                    "thought", PURPOSE, "POST", IMPORT_PATH, "assets", "POST", path
                )
            headers[HEADER] = await self.capabilities.authorize_request(assertion, grant)
        try:
            async with self.capabilities.client.stream(
                "POST",
                "http://assets:8080" + path,
                headers=headers,
                content=content,
                timeout=httpx.Timeout(600 if assertion else 10, connect=5),
            ) as response:
                if response.status_code in {401, 403, 404, 409, 413, 422}:
                    raise CapabilityDenied(response.status_code)
                if response.status_code != 200:
                    raise CapabilityUnavailable("归档批次结果尚未确认")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(data) + len(chunk) > 16 * 1024:
                        raise ValueError("归档回执过大")
                    data.extend(chunk)
                self.auth.verify(
                    response.headers.get("x-fpl-archive-receipt", ""),
                    "receipt",
                    path=path,
                    owner=owner,
                    nonce=nonce,
                    body=data,
                )
                return bytes(data)
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("归档批次结果尚未确认") from exc

    async def stage(self, owner, key, ordinal, description, path, assertion):
        target = (
            f"{PREFIX}/{key.batch_id}/{key.source_sha256}/files/{ordinal}/{description.fingerprint}"
        )
        try:
            with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as file:
                info = os.fstat(file.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size != description.byte_size:
                    raise ValueError("归档暂存文件长度不符")

                async def chunks():
                    while data := await run_sync(file.read, 1024 * 1024):
                        yield data

                result = AssetDescription.model_validate_json(
                    await self._send(
                        target,
                        owner,
                        assertion=assertion,
                        headers={
                            "Content-Type": "application/octet-stream",
                            "Content-Length": str(description.byte_size),
                            "X-Fpl-Upload-Descriptor": description.header(),
                        },
                        content=chunks(),
                    )
                )
            if (
                result.original_filename != description.filename
                or result.byte_size != description.byte_size
                or result.revision != 0
            ):
                raise ValueError("归档文件回执不匹配")
            return result
        except (OSError, ValueError) as exc:
            raise CapabilityUnavailable("归档文件暂存回执未确认") from exc

    async def stage_community(self, scope, description, upload, assertion):
        import json

        async def chunks():
            while data := await upload.read(1024 * 1024):
                yield data

        try:
            body = json.loads(
                await self._send(
                    scope.target,
                    scope.owner_id,
                    assertion=assertion,
                    community=scope,
                    headers={
                        "Content-Type": "application/octet-stream",
                        "Content-Length": str(description.byte_size),
                        "X-Fpl-Upload-Descriptor": description.header(),
                    },
                    content=chunks(),
                )
            )
            asset = AssetDescription.model_validate(body["asset"])
            manifest = ArchiveManifest(
                files=[ArchiveFileKey(ordinal=0, descriptor_sha256=description.fingerprint)],
                projections=[],
            )
            if (
                body["manifest_sha256"] != manifest.fingerprint
                or asset.original_filename != description.filename
                or asset.byte_size != description.byte_size
                or asset.revision != 0
            ):
                raise ValueError("community upload receipt mismatch")
            return asset, manifest.fingerprint
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CapabilityUnavailable("社区附件暂存回执未确认") from exc

    @staticmethod
    def _state(body, allowed):
        import json

        try:
            result = json.loads(body)
            state = result["state"]
            if set(result) != {"state"} or state not in allowed:
                raise ValueError("归档批次回执状态无效")
            return state
        except (KeyError, TypeError, ValueError) as exc:
            raise CapabilityUnavailable("归档批次回执状态未确认") from exc

    async def seal(self, owner, key, manifest, assertion):
        return self._state(
            await self._send(
                f"{PREFIX}/{key.batch_id}/{key.source_sha256}/seal/{manifest.fingerprint}",
                owner,
                assertion=assertion,
                headers={"Content-Type": "application/json"},
                content=manifest.model_dump_json().encode(),
            ),
            {"sealed"},
        )

    async def settle(self, outcome):
        return self._state(
            await self._send(
                SETTLE_PATH,
                outcome.owner,
                decision=True,
                headers={"Content-Type": "application/json"},
                content=outcome.model_dump_json().encode(),
            ),
            {"published" if outcome.decision == "commit" else "aborted"},
        )
