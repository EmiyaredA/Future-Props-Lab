"""Target results bind the request nonce and never trust an unsigned absence."""

import httpx
import pytest

from fpl_creative.install_authorization import InstallSource
from fpl_creative.install_target import HttpCreativeInstallTarget
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeInstallPart
from fpl_runtime.creative_results import CreativeResultAuthenticator
from fpl_runtime.integration_intents import digest


def batch():
    return CreativeInstallBatch(
        operation_id="11111111-1111-1111-1111-111111111111",
        root_release_id="release",
        parts=[
            CreativeInstallPart(
                release_id="release",
                kind="tool_api",
                title="Tool",
                target_name="Tool",
                summary="",
                manifest={"method": "GET", "url": "https://example.test"},
            )
        ],
    )


async def test_unsigned_or_replayed_absence_never_allows_new_submission(monkeypatch):
    secret, value = "r" * 48, batch()
    signer = CreativeResultAuthenticator(secret)
    body = b'{"detail":"creative_install_not_found"}'
    signature = signer.sign(
        action="receipt",
        operation=value.operation_id,
        fingerprint=digest(value.model_dump(mode="json")),
        nonce="a" * 32,
        status=404,
        body=body,
    )
    source = InstallSource("source", "evidence", b'{"release_id":"release"}')
    monkeypatch.setattr("fpl_creative.install_target.secrets.token_hex", lambda _n: "b" * 32)
    for header in ({}, {"X-Fpl-Creative-Result": signature}):

        async def reply(_request, result_headers=header):
            return httpx.Response(404, headers=result_headers, content=body)

        target = HttpCreativeInstallTarget(
            creative_peer_credential="c" * 48,
            result_credential=secret,
            transport=httpx.MockTransport(reply),
        )
        with pytest.raises(CapabilityUnavailable):
            await target.receipt(source, value)


def test_signature_is_bound_to_action_status_batch_and_body():
    signer = CreativeResultAuthenticator("r" * 48)
    options = dict(
        action="receipt",
        operation="operation",
        fingerprint="f" * 64,
        nonce="a" * 32,
        status=404,
        body=b"{}",
    )
    signature = signer.sign(**options)
    signer.verify(signature, **options)
    for changed in (
        {"action": "cancel"},
        {"status": 200},
        {"fingerprint": "0" * 64},
        {"nonce": "b" * 32},
        {"body": b'{"other":true}'},
    ):
        with pytest.raises(ValueError):
            signer.verify(signature, **(options | changed))
