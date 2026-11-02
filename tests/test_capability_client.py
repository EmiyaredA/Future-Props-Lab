"""Service requests exchange narrow assertions and never forward original browser credentials."""

import json
from pathlib import Path

import httpx
import pytest

from fpl_runtime.capability_client import CapabilityClient, CapabilityDenied, CapabilityUnavailable
from fpl_runtime.routing import RouteCatalog

CATALOG = RouteCatalog.read(Path(__file__).resolve().parents[1] / "deploy/contracts/ownership.json")


def client(handler):
    return CapabilityClient(
        service="assets",
        credential="private-service-key",
        catalog=CATALOG,
        transport=httpx.MockTransport(handler),
    )


async def test_asset_project_lookup_uses_only_scoped_exchange_and_target_assertion():
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.host == "identity":
            assert request.headers["authorization"] == "Bearer private-service-key"
            body = json.loads(request.content)
            assert body == {
                "caller": "assets",
                "purpose": "assets.visual-project.read",
                "source_method": "GET",
                "source_path": "/v1/files",
                "target_service": "visual",
                "target_method": "GET",
                "target_path": "/v1/visual-workshop/projects/owned",
                "assertion": "original-source-assertion",
            }
            return httpx.Response(200, json={"assertion": "narrow-target-assertion"})
        assert request.url == "http://visual:8080/v1/visual-workshop/projects/owned"
        assert request.headers["x-fpl-context"] == "narrow-target-assertion"
        assert "cookie" not in request.headers and "authorization" not in request.headers
        return httpx.Response(200, json={"id": "owned"})

    capability = client(handler)
    try:
        assert await capability.project_exists(
            assertion="original-source-assertion",
            source_method="GET",
            source_path="/v1/files",
            project_id="owned",
        )
        assert len(calls) == 2
    finally:
        await capability.close()


@pytest.mark.parametrize(
    "status, exception",
    [
        (401, CapabilityDenied),
        (403, CapabilityDenied),
        (500, CapabilityUnavailable),
        (302, CapabilityUnavailable),
        (204, CapabilityUnavailable),
    ],
)
async def test_target_errors_do_not_become_false_ownership_or_redirects(status, exception):
    def handler(request):
        if request.url.host == "identity":
            return httpx.Response(200, json={"assertion": "narrow"})
        return httpx.Response(
            status, headers={"Location": "https://not-an-internal-service.invalid"}
        )

    capability = client(handler)
    try:
        with pytest.raises(exception):
            await capability.project_exists(
                assertion="source",
                source_method="POST",
                source_path="/v1/files",
                project_id="owned",
            )
    finally:
        await capability.close()


async def test_absent_resource_is_the_only_normal_false_result():
    def handler(request):
        return (
            httpx.Response(200, json={"assertion": "narrow"})
            if request.url.host == "identity"
            else httpx.Response(404)
        )

    capability = client(handler)
    try:
        assert not await capability.project_exists(
            assertion="source", source_method="GET", source_path="/v1/files", project_id="missing"
        )
    finally:
        await capability.close()


@pytest.mark.parametrize(
    "project", ["../another", "owned?owner=beta", "https://other.invalid", "owned%2Fother"]
)
async def test_unregistered_destinations_are_rejected_before_network(project):
    def handler(_request):
        raise AssertionError("Invalid grant must not make any network request")

    capability = client(handler)
    try:
        with pytest.raises(CapabilityDenied):
            await capability.project_exists(
                assertion="source", source_method="GET", source_path="/v1/files", project_id=project
            )
    finally:
        await capability.close()
