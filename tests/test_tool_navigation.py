import httpx
import pytest
from sqlalchemy import delete

from studio.apps.tools.storage.navigation_models import ToolNavigationItem
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
async def test_tool_navigation_state_is_persisted() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(ToolNavigationItem))
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        state = await client.get("/v1/tool-navigation/state")
        assert state.status_code == 200
        assert state.json() == {"items": []}

        favorite = await client.patch(
            "/v1/tool-navigation/tools/json-formatter",
            json={"is_favorite": True},
        )
        assert favorite.status_code == 200
        assert favorite.json()["is_favorite"] is True
        assert favorite.json()["favorite_updated_at"] is not None

        first_use = await client.post("/v1/tool-navigation/tools/json-formatter/use")
        second_use = await client.post("/v1/tool-navigation/tools/json-formatter/use")
        assert first_use.json()["use_count"] == 1
        assert second_use.json()["use_count"] == 2
        assert second_use.json()["last_used_at"] is not None

        unstarred = await client.patch(
            "/v1/tool-navigation/tools/json-formatter",
            json={"is_favorite": False},
        )
        assert unstarred.json()["is_favorite"] is False
        assert unstarred.json()["favorite_updated_at"] is None
        assert unstarred.json()["use_count"] == 2

        invalid = await client.post("/v1/tool-navigation/tools/Bad_ID/use")
        assert invalid.status_code == 422

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        persisted = (await client.get("/v1/tool-navigation/state")).json()["items"]
        assert persisted == [
            {
                "tool_id": "json-formatter",
                "is_favorite": False,
                "favorite_updated_at": None,
                "last_used_at": second_use.json()["last_used_at"],
                "use_count": 2,
            }
        ]

    async with SessionLocal() as session:
        await session.execute(delete(ToolNavigationItem))
        await session.commit()


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_tool_navigation_routes_use_studio_auth() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/v1/tool-navigation/state")).status_code == 401
        assert (
            await client.get("/v1/tool-navigation/state", headers={"X-Studio-Token": "legacy"})
        ).status_code == 401


async def test_retired_host_tool_operations_are_not_served():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for method, path in [
            ("GET", "/v1/tool-navigation/storage-usage"),
            ("POST", "/v1/tool-navigation/storage-usage/analyze"),
            ("POST", "/v1/tool-navigation/storage-usage/open-directory"),
            ("GET", "/v1/tool-navigation/codex-source"),
            ("PUT", "/v1/tool-navigation/codex-source"),
            ("POST", "/v1/tool-navigation/codex-source/restore"),
        ]:
            response = await client.request(method, path, json={})
            assert response.status_code == 404, (method, path, response.text)
