"""The same link use case accepts SQLite, remote protocol and in-memory resource readers."""

from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import DateTime, String
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from studio.apps.gateway.clients.resource_reader import ServiceResources
from studio.apps.gateway.storage.website_resources import WebsiteResources
from studio.apps.gateway.use_cases.resource_links import ResourceLinkError, ResourceLinks
from studio.contracts.gateway.automation import AutomationOpenIn
from studio.contracts.identity.principal import StudioPrincipal


class Records(DeclarativeBase):
    pass


class Project(Records):
    __tablename__ = "port_test_projects"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)


class MemoryResources:
    async def exists(self, owner, _kind, resource_id):
        return (owner, resource_id) == ("owner", "owned")


@pytest.fixture(params=["memory", "sqlite", "remote"])
async def reader(request, tmp_path):
    if request.param == "memory":
        yield MemoryResources()
        return
    if request.param == "remote":

        class Capabilities:
            async def resource_exists(self, *, assertion, target_service, target_path):
                assert assertion == "verified-request-assertion"
                assert target_service == "visual"
                return target_path == "/v1/visual-workshop/projects/owned"

        yield ServiceResources(Capabilities(), "verified-request-assertion", "owner")
        return
    engine = create_async_engine("sqlite+aiosqlite:///" + str(tmp_path / "resources.db"))
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Records.metadata.create_all)
        async with async_sessionmaker(engine)() as session:
            session.add_all(
                [
                    Project(id="owned", owner_user_id="owner"),
                    Project(id="foreign", owner_user_id="other"),
                    Project(id="deleted", owner_user_id="owner", deleted_at=datetime(2026, 1, 1)),
                ]
            )
            await session.commit()
            yield WebsiteResources(session, {"visual": Project})
    finally:
        await engine.dispose()


@pytest.fixture
def principal():
    return StudioPrincipal("owner", False, "session", frozenset({"studio:read", "studio:write"}))


async def test_owned_link_and_denied_resources_use_the_same_contract(reader, principal):
    use_case = ResourceLinks(reader)
    command = AutomationOpenIn(kind="visual", resource_id="owned")
    assert await use_case.open(principal, command) == "/apps/visual-workshop/projects/owned/canvas"
    for identifier in ("foreign", "missing", "deleted"):
        with pytest.raises(ResourceLinkError) as failure:
            await use_case.open(principal, command.model_copy(update={"resource_id": identifier}))
        assert failure.value.code == "resource_not_found"
    with pytest.raises(ResourceLinkError):
        await use_case.open(replace(principal, user_id="unrelated"), command)


async def test_denied_edit_does_not_query_resource_or_produce_link(principal):
    class NeverRead:
        async def exists(self, *_args):
            raise AssertionError("permission must be checked before resource access")

    principal = replace(principal, scopes=frozenset({"studio:read"}))
    with pytest.raises(ResourceLinkError) as failure:
        await ResourceLinks(NeverRead()).open(
            principal, AutomationOpenIn(kind="tool-api", resource_id="owned", view="edit")
        )
    assert failure.value.code == "insufficient_permission"
