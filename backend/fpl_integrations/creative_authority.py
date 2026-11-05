"""Request-bound Creative decisions fetched by the Integrations service."""

import re
import secrets

import httpx
from fastapi import HTTPException

from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeOperationGrant
from fpl_runtime.creative_results import CreativeResultAuthenticator
from fpl_runtime.creative_source_evidence import strict_json
from fpl_runtime.creative_transport import CreativeAttestedRequest, CreativeDecisionRequest
from fpl_runtime.integration_intents import digest

from .creative_installations import validate_grant

DECISION_PATH = "/_internal/v1/creative-install/decision"


class CreativeHttpAuthority:
    def __init__(
        self,
        *,
        creative_peer_credential,
        integrations_credential,
        result_credential,
        transport=None,
    ):
        if (
            any(
                not isinstance(value, str) or not value.isascii() or len(value) < 32
                for value in (creative_peer_credential, integrations_credential, result_credential)
            )
            or len({creative_peer_credential, integrations_credential, result_credential}) != 3
        ):
            raise ValueError("Creative installation credentials must be distinct")
        self.creative_peer_credential = creative_peer_credential
        self.integrations_credential = integrations_credential
        self.transport = transport
        self.result_authenticator = CreativeResultAuthenticator(result_credential)

    async def grant(self, *, request, purpose, operation_id, fingerprint, value, source):
        supplied = request.headers.get("authorization", "")
        if (
            request.headers.get("origin")
            or request.headers.get("cookie")
            or not supplied.isascii()
            or not secrets.compare_digest(supplied, "Bearer " + self.creative_peer_credential)
        ):
            raise HTTPException(403, "creative_install_peer_required")
        nonce = request.headers.get("x-fpl-creative-nonce", "")
        if not re.fullmatch(r"[a-f0-9]{32}", nonce):
            raise HTTPException(403, "creative_install_nonce_required")
        if (
            purpose not in {"install", "receipt", "cancel"}
            or not isinstance(value, CreativeInstallBatch)
            or not isinstance(source, CreativeAttestedRequest)
            or operation_id != value.operation_id
            or fingerprint != digest(value.model_dump(mode="json"))
        ):
            raise HTTPException(403, "creative_install_source_invalid")
        payload = CreativeDecisionRequest(action=purpose, source=source, batch=value)
        try:
            async with httpx.AsyncClient(
                transport=self.transport, trust_env=False, follow_redirects=False, timeout=10
            ) as client:
                async with client.stream(
                    "POST",
                    "http://creative:8080" + DECISION_PATH,
                    headers={"Authorization": "Bearer " + self.integrations_credential},
                    json=payload.model_dump(mode="json"),
                ) as response:
                    if response.status_code in {401, 403}:
                        raise HTTPException(403, "creative_install_authorization_denied")
                    if response.status_code != 200:
                        raise HTTPException(503, "creative_install_authorization_unavailable")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 16384:
                            raise ValueError("decision response too large")
            value = strict_json(bytes(body))
            if not isinstance(value, dict) or set(value) != {
                "owner_user_id",
                "purpose",
                "operation_id",
                "fingerprint",
                "expires_at",
            }:
                raise ValueError("invalid decision")
            decision = CreativeOperationGrant(**value)
            validate_grant(
                decision, purpose=purpose, operation=operation_id, fingerprint_value=fingerprint
            )
            return decision
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise HTTPException(503, "creative_install_authorization_unavailable") from None
