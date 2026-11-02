"""Delegation is limited by caller, source operation, purpose and target resource."""

from dataclasses import replace
from pathlib import Path

import pytest

from fpl_runtime.delegation import RequestGrant, permitted
from fpl_runtime.resource_routes import RESOURCE_ROUTES, page_link
from fpl_runtime.routing import RouteCatalog

CATALOG = RouteCatalog.read(Path(__file__).resolve().parents[1] / "deploy/contracts/ownership.json")


def grant(**changes):
    base = RequestGrant(
        "gateway",
        "automation.resource.read",
        "POST",
        "/v1/automation/open",
        "visual",
        "GET",
        "/v1/visual-workshop/projects/owned-id",
    )
    return replace(base, **changes)


def test_resource_lookup_is_registered_to_the_expected_service():
    for route in RESOURCE_ROUTES.values():
        operation = CATALOG.match("GET", route.api.format(id="owned-id"))
        assert operation is not None, route
        assert operation.service == route.service
    assert permitted(grant(), CATALOG)
    assert page_link("visual", "owned") == "/apps/visual-workshop/projects/owned/canvas"
    assert (
        page_link("skill", "owned", "details") == "/integrations/skills?view=details&resource=owned"
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"caller": "agents"},
        {"purpose": "account.impersonate"},
        {"source_method": "GET"},
        {"source_path": "/v1/automation/runtime"},
        {"target_service": "models"},
        {"target_method": "DELETE"},
        {"target_path": "/v1/visual-workshop/projects/owned-id?owner=another"},
        {"target_path": "/v1/visual-workshop/projects/../../account"},
        {"target_path": "/v1/platform/accounts"},
    ],
)
def test_no_service_wide_or_user_chosen_destination_is_authorized(changes):
    assert not permitted(grant(**changes), CATALOG)


@pytest.mark.parametrize(
    "method, path",
    [
        ("GET", "/v1/files"),
        ("POST", "/v1/files"),
        ("GET", "/v1/file-folders"),
        ("POST", "/v1/file-folders"),
        ("POST", "/v1/file-library/asset-imports"),
    ],
)
def test_asset_project_validation_has_registered_source_operations(method, path):
    request = RequestGrant(
        "assets",
        "assets.visual-project.read",
        method,
        path,
        "visual",
        "GET",
        "/v1/visual-workshop/projects/owned",
    )
    assert permitted(request, CATALOG)
    assert not permitted(replace(request, target_method="DELETE"), CATALOG)
    assert not permitted(replace(request, source_path="/v1/automation/open"), CATALOG)
    assert not permitted(replace(request, caller="models"), CATALOG)
