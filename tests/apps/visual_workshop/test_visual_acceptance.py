"""Automatic review retirement keeps manual approval and historical evidence."""

from uuid import uuid4

import httpx
from sqlalchemy import delete, select

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun, AcceptanceStandardVersion
from studio.apps.visual_workshop.acceptance.retirement import retire_pending_reviews
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import VisualWorkshopProject
from website_test_support import SessionLocal, app


async def test_retired_routes_are_explicit_scoped_and_absent_from_public_contract():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await client.post(
            "/v1/visual-workshop/projects", json={"title": "手动确认", "kind": "canvas"}
        )
        root = f"/v1/visual-workshop/projects/{project.json()['id']}"
        for method, suffix in [
            ("GET", "/acceptance/models"),
            ("GET", "/acceptance/summary"),
            ("GET", "/acceptance/standard"),
            ("PUT", "/acceptance/standard"),
            ("GET", "/acceptance/runs"),
            ("POST", "/acceptance/runs"),
            ("GET", "/nodes/shot/acceptance"),
            ("PUT", "/nodes/shot/acceptance"),
            ("POST", "/nodes/shot/acceptance/runs"),
            ("POST", "/acceptance/runs/old/samples"),
        ]:
            response = await client.request(method, root + suffix)
            assert response.status_code == 410, response.text
            assert response.json()["code"] == "visual_acceptance_retired"
        for path in ["acceptance/catalog", "acceptance-templates"]:
            assert (await client.get("/v1/visual-workshop/" + path)).status_code == 410
        assert (
            await client.get("/v1/visual-workshop/projects/missing/acceptance/summary")
        ).status_code == 404
        assert not any(
            "/acceptance" in path
            for path in app.openapi()["paths"]
            if path.startswith("/v1/visual-workshop/")
        )


async def test_retirement_is_idempotent_owner_scoped_and_does_not_delete_results():
    ids = []
    for _index in range(2):
        owner = str(uuid4())
        async with SessionLocal(info={"owner_user_id": owner}) as db:
            project = VisualWorkshopProject(owner_user_id=owner, title="历史项目", kind="canvas")
            db.add(project)
            await db.flush()
            output = VisualNodeOutput(
                project_id=project.id,
                node_id="shot",
                version=1,
                kind="text",
                text="历史输出",
                source="text",
                source_key="original",
            )
            standard = AcceptanceStandardVersion(
                owner_user_id=owner, project_id=project.id, version=1, document={}
            )
            db.add_all([output, standard])
            await db.flush()
            for state in ("queued", "completed"):
                row = AcceptanceRun(
                    owner_user_id=owner,
                    project_id=project.id,
                    node_id="shot",
                    output_id=output.id,
                    standard_id=standard.id,
                    request_id=state,
                    fingerprint="a" * 64,
                    status=state,
                    snapshot={"legacy": True},
                    results=[{"verdict": "keep"}],
                    evidence=[],
                )
                db.add(row)
                await db.flush()
                ids.append((owner, row.id, state))
            await db.commit()
    await retire_pending_reviews(SessionLocal)
    await retire_pending_reviews(SessionLocal)
    for owner, identity, previous in ids:
        async with SessionLocal(info={"owner_user_id": owner}) as db:
            row = await db.get(AcceptanceRun, identity)
            assert row.status == ("cancelled" if previous == "queued" else "completed")
            assert row.revision == (1 if previous == "queued" else 0)
            assert row.results == [{"verdict": "keep"}]
            assert row.snapshot == {"legacy": True}
            assert (
                await db.scalar(
                    select(VisualNodeOutput).where(VisualNodeOutput.id == row.output_id)
                )
            ).text == "历史输出"

    for owner in {owner for owner, _, _ in ids}:
        async with SessionLocal(info={"owner_user_id": owner}) as db:
            await db.execute(delete(AcceptanceRun).where(AcceptanceRun.owner_user_id == owner))
            await db.execute(
                delete(VisualWorkshopProject).where(VisualWorkshopProject.owner_user_id == owner)
            )
            await db.commit()
