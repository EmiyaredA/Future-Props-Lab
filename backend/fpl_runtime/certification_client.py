"""Transport for one certification command and its owner's audit acknowledgement."""

import json

import httpx
import jwt

from .capability_client import CapabilityUnavailable
from .project_certification import (
    MAX_BODY,
    PREFIX,
    CertificationAudit,
    CertificationAuthorization,
    CertificationProof,
    ConfirmedCertification,
    SignedCertificationAudit,
    verify_audit_receipt,
    verify_certification,
)


class CertificationRejected(RuntimeError):
    def __init__(self, status, detail):
        super().__init__("作品认证请求被拒绝")
        self.status, self.detail = status, detail


class CertificationClient:
    def __init__(self, *, credential, public_key, transport=None):
        self.credential, self.public_key = credential, public_key
        self.client = httpx.AsyncClient(
            transport=transport, trust_env=False, follow_redirects=False, timeout=10
        )

    async def close(self):
        await self.client.aclose()

    async def _post(self, service, action, body, *, token=None):
        try:
            async with self.client.stream(
                "POST",
                f"http://{service}:8080{PREFIX}/{action}",
                headers={"Authorization": "Bearer " + (token or self.credential)},
                json=body,
            ) as response:
                if response.status_code not in {200, 401, 403, 404, 409, 422}:
                    raise CapabilityUnavailable("作品认证回执暂不可用")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(data) + len(chunk) > MAX_BODY:
                        raise ValueError("certification receipt too large")
                    data.extend(chunk)
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise ValueError("invalid certification receipt")
                if response.status_code != 200:
                    detail = result if "code" in result else result.get("detail")
                    if isinstance(detail, dict):
                        detail = {**detail, "message": detail.get("message", detail.get("detail"))}
                        detail = {
                            key: detail[key]
                            for key in ("code", "message", "current")
                            if detail.get(key) is not None
                        }
                    else:
                        detail = {"code": "certification_rejected"}
                    raise CertificationRejected(response.status_code, detail)
                return result
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            raise CapabilityUnavailable("作品认证结果尚未确认") from exc

    async def certify(self, assertion, command, owner):
        try:
            authorization = await self._post(
                "identity",
                "authorize",
                CertificationAuthorization(assertion=assertion, command=command).model_dump(
                    mode="json"
                ),
            )
            token = CertificationProof.model_validate(authorization).authority
            grant = verify_certification(token, public_key=self.public_key)
            if grant.actor.user_id != owner or grant.command != command:
                raise ValueError("certification authorization mismatch")
            # A repeat after a lost acknowledgement must carry the exact same intent.
            try:
                result = await self._post(command.kind, "apply", {}, token=token)
            except CapabilityUnavailable:
                result = await self._post(command.kind, "apply", {}, token=token)
            confirmed = ConfirmedCertification.model_validate(result)
            if not confirmed.result.matches(command):
                raise ValueError("certification result mismatch")
            verify_audit_receipt(confirmed.proof, command, owner, public_key=self.public_key)
            return confirmed.result
        except (ValueError, TypeError, KeyError, jwt.InvalidTokenError) as exc:
            raise CapabilityUnavailable("作品认证结果尚未确认") from exc

    async def active(self, authority):
        result = await self._post(
            "identity", "check", CertificationProof(authority=authority).model_dump(mode="json")
        )
        if type(result.get("active")) is not bool:
            raise CapabilityUnavailable("作品认证活性回执无效")
        return result["active"]

    async def audit(self, authority, grant, result):
        payload = await self._post(
            "identity",
            "audit",
            CertificationAudit(authority=authority, result=result).model_dump(mode="json"),
        )
        try:
            signed = SignedCertificationAudit.model_validate(payload)
            if (
                verify_audit_receipt(
                    signed.proof, grant.command, grant.actor.user_id, public_key=self.public_key
                )
                != signed.receipt
            ):
                raise ValueError("certification audit receipt mismatch")
        except (ValueError, TypeError, KeyError, jwt.InvalidTokenError) as exc:
            raise CapabilityUnavailable("作品认证审计回执未确认") from exc
        return signed
