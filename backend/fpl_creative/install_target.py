"""Authenticated, request-bound Integrations receipt and installation transport."""

import base64
import secrets
from dataclasses import dataclass, field

import httpx

from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.creative_integrations import CreativeInstallBatch
from fpl_runtime.creative_results import CreativeResultAuthenticator
from fpl_runtime.creative_source_evidence import strict_json
from fpl_runtime.creative_transport import CreativeInstallSourceContext
from fpl_runtime.integration_intents import digest

from .install_authorization import InstallSource

TARGET = "/_internal/v1/creative-integrations/"


@dataclass(frozen=True)
class VerifiedTargetResult:
    action: str
    operation: str
    fingerprint: str
    nonce: str
    status: int
    body: bytes = field(repr=False)
    signature: str = field(repr=False)


class HttpCreativeInstallTarget:
    def __init__(
        self, *, creative_peer_credential, result_credential, transport=None, archives=None
    ):
        if (
            not isinstance(creative_peer_credential, str)
            or not creative_peer_credential.isascii()
            or len(creative_peer_credential) < 32
            or not isinstance(result_credential, str)
            or creative_peer_credential == result_credential
        ):
            raise ValueError("Creative target credentials must be distinct")
        self.peer = creative_peer_credential
        self.authenticator = CreativeResultAuthenticator(result_credential)
        self.transport, self.archives = transport, archives

    def context(self, source):
        if not isinstance(source, InstallSource):
            raise ValueError("Creative install source is invalid")
        return CreativeInstallSourceContext(
            assertion=source.assertion,
            evidence=source.evidence,
            body_base64=base64.b64encode(source.raw_body).decode("ascii"),
        )

    async def request(self, action, source, batch, *, files=None):
        if action not in {"install", "receipt", "cancel"} or not isinstance(
            batch, CreativeInstallBatch
        ):
            raise ValueError("Creative target operation is invalid")
        context = self.context(source)
        checksum = digest(batch.model_dump(mode="json"))
        nonce = secrets.token_hex(16)
        headers = {"Authorization": "Bearer " + self.peer, "X-Fpl-Creative-Nonce": nonce}
        try:
            async with httpx.AsyncClient(
                transport=self.transport,
                trust_env=False,
                follow_redirects=False,
                timeout=httpx.Timeout(600, connect=5),
            ) as client:
                if action == "install":
                    options = {
                        "data": {
                            "batch": batch.model_dump_json(),
                            "source": context.model_dump_json(),
                        },
                        "files": files,
                    }
                else:
                    options = {
                        "json": {
                            "batch": batch.model_dump(mode="json"),
                            "source": context.model_dump(mode="json"),
                        }
                    }
                async with client.stream(
                    "POST", "http://integrations:8080" + TARGET + action, headers=headers, **options
                ) as response:
                    if response.status_code in {401, 403}:
                        raise CapabilityDenied(response.status_code)
                    if response.status_code != 200 and not (
                        action == "receipt" and response.status_code == 404
                    ):
                        raise CapabilityUnavailable("目标安装结果未确认")
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 2 * 1024 * 1024:
                            raise ValueError("target result too large")
                    result = VerifiedTargetResult(
                        action,
                        batch.operation_id,
                        checksum,
                        nonce,
                        response.status_code,
                        bytes(raw),
                        response.headers.get("x-fpl-creative-result", ""),
                    )
            self.validate(result, action=action, batch=batch)
            return result
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise CapabilityUnavailable("目标安装结果未确认") from None

    def validate(self, result, *, action, batch):
        if (
            not isinstance(result, VerifiedTargetResult)
            or result.action != action
            or result.operation != batch.operation_id
            or result.fingerprint != digest(batch.model_dump(mode="json"))
        ):
            raise ValueError("target result context mismatch")
        self.authenticator.verify(
            result.signature,
            action=action,
            operation=result.operation,
            fingerprint=result.fingerprint,
            nonce=result.nonce,
            status=result.status,
            body=result.body,
        )
        value = strict_json(result.body)
        if not isinstance(value, dict):
            raise ValueError("target result is invalid")
        return value

    async def receipt(self, source, batch):
        result = await self.request("receipt", source, batch)
        return None if result.status == 404 else result

    async def install(self, source, batch):
        if any(part.kind == "skill" for part in batch.parts):
            if self.archives is None:
                raise CapabilityUnavailable("Skill 归档传输尚未配置")
            async with self.archives.open(batch) as files:
                return await self.request("install", source, batch, files=files)
        return await self.request("install", source, batch)

    async def cancel(self, source, batch):
        return await self.request("cancel", source, batch)

    async def verify_receipt(self, _source, batch, response):
        if not isinstance(response, VerifiedTargetResult) or response.status != 200:
            raise ValueError("target receipt is invalid")
        if response.action == "cancel":
            value = self.validate(response, action="cancel", batch=batch)
            if (
                set(value) != {"state", "receipt"}
                or value["state"] != "committed"
                or not isinstance(value["receipt"], dict)
            ):
                raise ValueError("target receipt is invalid")
            return value["receipt"]
        if response.action not in {"install", "receipt"}:
            raise ValueError("target receipt is invalid")
        return self.validate(response, action=response.action, batch=batch)

    async def verify_cancellation(self, _source, batch, response):
        if not isinstance(response, VerifiedTargetResult) or response.status != 200:
            raise ValueError("target cancellation is invalid")
        value = self.validate(response, action="cancel", batch=batch)
        if value.get("state") == "committed" and set(value) == {"state", "receipt"}:
            return {"state": "committed", "receipt": response}
        return value
