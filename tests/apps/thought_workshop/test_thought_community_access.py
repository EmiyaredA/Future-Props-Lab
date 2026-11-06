"""Published asset evidence never grants an arbitrary source-account file."""

from types import SimpleNamespace

import pytest
from sqlalchemy import delete, update

from studio.apps.thought_workshop.community.community_access import published_asset
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


class Directory:
    def for_session(self, _session):
        return self

    async def current(self, principal):
        return principal


@pytest.fixture
async def community(tmp_path):
    apply(tmp_path / "service.db", "thought", MIGRATIONS)
    db = Database("thought", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    async with db.sessions(info={"owner_user_id": "source"}) as session:
        session.add(ThoughtKnowledgeBase(id="book", owner_user_id="source", title="Book"))
        await session.flush()
        session.add(
            ThoughtNote(
                id="note",
                owner_user_id="source",
                knowledge_base_id="book",
                title="Published",
                kind="note",
                document={
                    "type": "doc",
                    "content": [{"type": "image", "attrs": {"assetId": "visible"}}],
                },
                search_text="",
            )
        )
        await session.flush()
        session.add(
            Publication(
                id="pub",
                owner_user_id="source",
                knowledge_base_id="book",
                publisher_id="source",
                title="Publication",
                cover_asset_id="cover",
            )
        )
        await session.flush()
        session.add(PublishedArticle(publication_id="pub", note_id="note", visibility="private"))
        session.add(
            ArticleMember(publication_id="pub", note_id="note", user_id="viewer", role="read")
        )
        await session.commit()
    yield db
    await db.close()


def actor(identity):
    return SimpleNamespace(user_id=identity, platform_role="user", auth_kind="session")


async def evidence(db, who, asset, **kwargs):
    async with db.sessions(
        info={"allow_system_reads": True, "thought_directory": Directory()}
    ) as session:
        return await published_asset(session, actor(who), "pub", asset, **kwargs)


async def test_only_referenced_current_article_and_published_cover_have_evidence(community):
    value = await evidence(community, "viewer", "visible", note_id="note")
    assert (value.viewer_id, value.source_owner_id, value.note_revision) == ("viewer", "source", 0)
    assert not value.cover and value.article_revision == 0
    assert (await evidence(community, "viewer", "visible")).note_id == "note"
    assert (await evidence(community, "viewer", "cover", cover=True)).cover
    for who, asset, options in [
        ("viewer", "unreferenced", {"note_id": "note"}),
        ("viewer", "cover", {"note_id": "note"}),
        ("stranger", "visible", {"note_id": "note"}),
        ("stranger", "cover", {"cover": True}),
    ]:
        with pytest.raises(ThoughtError) as exc:
            await evidence(community, who, asset, **options)
        assert exc.value.status == 404


async def test_fresh_check_rejects_revoked_membership_and_changed_article(community):
    before = await evidence(community, "viewer", "visible", note_id="note")
    async with community.sessions(info={"owner_user_id": "source"}) as session:
        await session.execute(
            update(ThoughtNote)
            .where(ThoughtNote.id == "note")
            .values(document={"type": "doc", "content": []}, revision=1)
        )
        await session.commit()
    with pytest.raises(ThoughtError):
        await evidence(community, "viewer", "visible", note_id="note")
    assert before.note_revision == 0
    async with community.sessions(info={"owner_user_id": "source"}) as session:
        await session.execute(delete(ArticleMember).where(ArticleMember.user_id == "viewer"))
        await session.commit()
    with pytest.raises(ThoughtError):
        await evidence(community, "viewer", "cover", cover=True)


async def test_source_bound_session_is_not_used_as_authorization_context(community):
    async with community.sessions(
        info={"owner_user_id": "source", "thought_directory": Directory()}
    ) as session:
        with pytest.raises(ValueError, match="未绑定账号"):
            await published_asset(session, actor("viewer"), "pub", "visible", note_id="note")


async def test_only_browser_sessions_can_receive_published_asset_evidence(community):
    async with community.sessions(
        info={"allow_system_reads": True, "thought_directory": Directory()}
    ) as session:
        credential = SimpleNamespace(
            user_id="viewer", platform_role="user", auth_kind="management_api_key"
        )
        with pytest.raises(ThoughtError) as exc:
            await published_asset(session, credential, "pub", "visible", note_id="note")
        assert exc.value.status == 404


async def test_multitable_exposes_current_attachments_but_not_historical_pins(community):
    from studio.apps.thought_workshop.multitable.models import (
        DataAsset,
        DataField,
        DataRecord,
        DataTable,
        DataView,
    )

    async with community.sessions(info={"owner_user_id": "source"}) as session:
        await session.execute(
            update(ThoughtNote)
            .where(ThoughtNote.id == "note")
            .values(kind="multitable", document={"type": "doc", "content": []}, revision=1)
        )
        session.add(DataTable(id="table", note_id="note", name="Table", position=0))
        await session.flush()
        session.add(
            DataField(
                id="field", table_id="table", name="Attachments", type="attachment", position=0
            )
        )
        session.add(
            DataRecord(id="record", table_id="table", position=0, values={"field": ["current"]})
        )
        session.add(DataView(id="view", table_id="table", name="Grid", type="grid", position=0))
        session.add(DataAsset(note_id="note", asset_id="historic"))
        await session.commit()
    assert (await evidence(community, "viewer", "current", note_id="note")).note_revision == 1
    assert (await evidence(community, "viewer", "current")).note_id == "note"
    with pytest.raises(ThoughtError):
        await evidence(community, "viewer", "historic", note_id="note")
    with pytest.raises(ThoughtError):
        await evidence(community, "viewer", "historic")


async def test_unpublished_upload_is_not_a_published_body_read(community):
    from studio.apps.thought_workshop.publication.models import CommunityUpload

    async with community.sessions(info={"owner_user_id": "source"}) as session:
        await session.execute(
            update(ArticleMember).where(ArticleMember.user_id == "viewer").values(role="edit")
        )
        session.add(CommunityUpload(note_id="note", asset_id="pending", user_id="viewer"))
        await session.commit()
    with pytest.raises(ThoughtError) as exc:
        await evidence(community, "viewer", "pending", note_id="note")
    assert exc.value.status == 404
