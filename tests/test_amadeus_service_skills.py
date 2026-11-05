"""Exercise exact Skill pins across Amadeus, Identity and Integrations."""

import io
from dataclasses import replace
from zipfile import ZipFile

import httpx
from cryptography.fernet import Fernet
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize
from tests.test_integrations_application import Ports

from app.runtime.config import Settings
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS as AMADEUS_MIGRATIONS
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.integrations.storage.migrations.registry import (
    MIGRATIONS as INTEGRATION_MIGRATIONS,
)
from studio.assembly.independent.amadeus.application import create_app as create_amadeus
from studio.assembly.independent.integrations.application import create_app as create_integrations
from studio.contracts.amadeus.amadeus_skills import PURPOSE, SKILL_SOURCE
from studio.contracts.identity.delegation import RequestGrant, permitted
from studio.runtime.database.migrations import apply


def skill_zip(content):
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("SKILL.md", "---\nname: Test\ndescription: Owned test\n---\n" + content)
        archive.writestr("references/嵌套/guide.txt", content)
    return {"file": ("skill.zip", stream.getvalue(), "application/zip")}


async def test_skill_pin_keeps_exact_version_and_requires_live_owned_source(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    amadeus_root, integrations_root = tmp_path / "amadeus", tmp_path / "integrations"
    for root, service, migrations in (
        (amadeus_root, "amadeus", AMADEUS_MIGRATIONS),
        (integrations_root, "integrations", INTEGRATION_MIGRATIONS),
    ):
        root.mkdir()
        apply(root / "service.db", service, migrations)

    credentials = {
        service: "isolated-skill-test-" + service * 4 for service in ("amadeus", "integrations")
    }
    case.identity.state.identity_options["service_credentials"].update(credentials)
    settings = Settings(
        _config_file=None,
        fpl_database_path=str(integrations_root / "service.db"),
        fpl_secrets_key=Fernet.generate_key().decode(),
    )
    port = Ports()
    integrations = create_integrations(
        settings=settings,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        identity=LiveAuthorization(
            service="integrations", credential=credentials["integrations"], transport=case.mesh
        ),
        intents=port,
        capacity=port,
        mcp_client=port,
        run_tasks=False,
    )
    case.mesh.apps["integrations"] = integrations
    amadeus = create_amadeus(
        state_root=amadeus_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=credentials["amadeus"],
        transport=case.mesh,
    )
    async with (
        amadeus.router.lifespan_context(amadeus),
        integrations.router.lifespan_context(integrations),
        httpx.AsyncClient(transport=case.mesh, base_url="http://integrations") as integration_api,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=amadeus), base_url="http://amadeus"
        ) as api,
    ):

        async def send(client, service, method, path, **kwargs):
            headers = await authorize(case, service, method, path)
            return await client.request(method, path, headers=headers, **kwargs)

        async def integrate(method, path, **kwargs):
            return await send(integration_api, "integrations", method, path, **kwargs)

        async def work(method, path, **kwargs):
            return await send(api, "amadeus", method, path, **kwargs)

        root = "/v1/integrations/skills"
        created = await integrate(
            "POST", root, files=skill_zip("Original"), data={"enabled": "true"}
        )
        assert created.status_code == 201, created.text
        skill = created.json()
        identity = skill["id"]

        conversations = "/v1/amadeus/conversations"
        conversation = (await work("POST", conversations)).json()["id"]
        base = f"{conversations}/{conversation}/skills/{identity}"
        load = base + "/load"
        assert (await integration_api.get(f"{SKILL_SOURCE}/{identity}/archive")).status_code == 401
        grant = RequestGrant(
            "amadeus",
            PURPOSE,
            "POST",
            load,
            "integrations",
            "GET",
            f"{SKILL_SOURCE}/{identity}/archive",
        )
        assert permitted(grant, CATALOG)
        assert not permitted(replace(grant, target_path=f"{SKILL_SOURCE}/other/archive"), CATALOG)

        pinned = await work("POST", load)
        assert pinned.status_code == 200, pinned.text
        assert pinned.json()["version"] == "v1"
        assert pinned.json()["content"].endswith("Original")
        nested = base + "/v1/files/references/嵌套/guide.txt"
        # Gateway submits the encoded target to Identity and signs the decoded path.
        signed = await authorize(case, "amadeus", "GET", str(httpx.URL(nested)))
        result = await api.get(nested, headers=signed)
        assert result.status_code == 200, result.text
        assert result.json()["content"] == "Original"

        updated = await integrate(
            "POST",
            f"{root}/{identity}/versions",
            files=skill_zip("Replacement"),
            data={"expected_revision": str(skill["revision"])},
        )
        assert updated.status_code == 200, updated.text
        changed = await integrate(
            "PATCH",
            f"{root}/{identity}",
            json={
                "expected_revision": updated.json()["revision"],
                "enabled": True,
                "default_version": "v2",
            },
        )
        assert changed.status_code == 200, changed.text
        assert (await work("POST", load)).json() == pinned.json()
        another = (await work("POST", conversations)).json()["id"]
        another_load = f"{conversations}/{another}/skills/{identity}/load"
        assert (await work("POST", another_load)).json()["version"] == "v2"
        disabled = await integrate(
            "PATCH",
            f"{root}/{identity}",
            json={
                "expected_revision": changed.json()["revision"],
                "enabled": False,
                "default_version": "v2",
            },
        )
        assert disabled.status_code == 200, disabled.text
        assert (await work("POST", load)).status_code == 409
        assert (await api.get(nested, headers=signed)).json()["content"] == "Original"
