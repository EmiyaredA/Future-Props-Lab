"""Both document transport and retirement work through the independent owner boundary."""

from uuid import uuid4

import httpx

from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument, VisualWorkshopProject
from studio.assembly.independent.visual_workshop.application import create_app
from studio.runtime.database.migrations import apply
from tests.apps.creative_workshop.test_creative_project_certification import CREDENTIALS
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


async def test_independent_storyboard_scope_cas_and_retirement(scenario, tmp_path):  # noqa: F811
    case = scenario
    apply(tmp_path / "visual" / "service.db", "visual", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["visual"] = CREDENTIALS["visual"]
    app = create_app(
        state_root=tmp_path / "visual",
        public_key=case.key.public_key(),
        credential=CREDENTIALS["visual"],
        catalog=CATALOG,
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps["visual"] = app
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=case.mesh, base_url="http://visual") as client,
    ):
        assert app.state.public_routes_complete
        projects = []
        for owner in (case.viewer, case.owner):
            async with app.state.database.sessions(info={"owner_user_id": owner}) as db:
                project = VisualWorkshopProject(title="镜头规划", kind="canvas")
                db.add(project)
                await db.flush()
                db.add(VisualCanvasDocument(project_id=project.id, nodes=[], edges=[]))
                await db.commit()
                projects.append(project.id)
        path = f"/v1/visual-workshop/projects/{projects[0]}/storyboard"
        response = await client.get(path, headers=await authorize(case, "visual", "GET", path))
        assert response.json() == {"revision": 0, "shots": []}
        body = {"expected_revision": 0, "shots": [{"id": str(uuid4()), "title": "独立分镜"}]}
        headers = await authorize(case, "visual", "PUT", path)
        assert (await client.put(path, headers=headers, json=body)).status_code == 200
        assert (await client.put(path, headers=headers, json=body)).status_code == 409
        foreign = path.replace(projects[0], projects[1])
        assert (
            await client.get(foreign, headers=await authorize(case, "visual", "GET", foreign))
        ).status_code == 404
        retired = path.removesuffix("/storyboard") + "/acceptance/summary"
        # Removed operations cannot obtain new Identity grants through the gateway.
        response = await case.browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": "visual",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": retired,
                "Origin": "http://127.0.0.1:19000",
                "X-CSRF-Token": case.csrf,
            },
        )
        assert response.status_code == 404
