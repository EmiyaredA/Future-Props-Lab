"""Published project roots work without any access to the Assets database."""

import json
from pathlib import Path

import httpx
import pytest
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_creative_project_certification import CREDENTIALS, ORIGIN, PROJECTS

from fpl_runtime.claims import HEADER
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]


async def authorize(case, kind, method, path):
    response = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": kind,
            "X-Fpl-Request-Method": method,
            "X-Fpl-Request-Uri": path,
            "Origin": ORIGIN,
            "X-CSRF-Token": case.csrf,
        },
    )
    assert response.status_code == 204, response.text
    return {HEADER: response.headers[HEADER]}


@pytest.mark.parametrize("kind", ["visual", "galgame"])
async def test_projects_create_owned_defaults_and_keep_the_published_contract(
    scenario,  # noqa: F811
    tmp_path,
    kind,
):
    case = scenario
    factory, migrations, model, _ = PROJECTS[kind]
    apply(tmp_path / "service.db", kind, migrations)
    app = factory(
        state_root=tmp_path,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        credential=CREDENTIALS[kind],
        transport=case.mesh,
        run_worker=False,
    )
    case.mesh.apps[kind] = app
    public = json.loads((ROOT / "web/src/generated/openapi.json").read_text())["paths"]
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/v1/"):
            for method, operation in operations.items():
                assert operation == public[path][method]
    prefix = f"/v1/{kind}-workshop/projects"
    suffix = "canvas" if kind == "visual" else "story"
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=f"http://{kind}"
        ) as http,
    ):

        async def request(method, path, **kwargs):
            return await http.request(
                method, path, headers=await authorize(case, kind, method, path), **kwargs
            )

        assert (await http.get(prefix)).status_code == 401
        assert (await request("GET", prefix)).json() == {"items": []}
        fields = {"title": "Owned project", **({"kind": "canvas"} if kind == "visual" else {})}
        created = await request("POST", prefix, json=fields)
        assert created.status_code == 200, created.text
        record = created.json()
        assert record["title"] == fields["title"]
        assert record["revision"] == 0 and not record["is_official"]
        path = prefix + "/" + record["id"]
        document = await request("GET", path + "/" + suffix)
        assert document.status_code == 200, document.text
        if kind == "visual":
            assert document.json()["nodes"] == []
            assert document.json()["categories"]
            changed = await request(
                "PATCH", path, json={"title": "Changed", "expected_revision": 0}
            )
            assert changed.status_code == 200, changed.text
            conflict = await request("PATCH", path, json={"title": "Stale", "expected_revision": 0})
            assert conflict.status_code == 409, conflict.text
            assert conflict.json()["current"]["title"] == "Changed"
            record = changed.json()
        else:
            assert document.json()["document"]["entryChapterId"] == "chapter-1"
        assert (await request("GET", path)).json() == record
        async with app.state.database.sessions(info={"owner_user_id": case.owner}) as session:
            session.add(
                model(
                    id="other",
                    owner_user_id=case.owner,
                    title="Other project",
                    **({"kind": "canvas"} if kind == "visual" else {}),
                )
            )
            await session.commit()
        assert (await request("GET", prefix + "/other")).status_code == 404
        assert (await request("GET", prefix + "/other/" + suffix)).status_code == 404
        assert (await request("GET", prefix)).json() == {"items": [record]}
