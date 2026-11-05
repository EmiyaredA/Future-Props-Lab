"""Exercise sealed Thought transfer, private maintenance and the old-site restore."""

import hashlib
import io
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from PIL import Image
from scripts.website import legacy_snapshot
from scripts.website.migrate_assets import ASSET_RECORDS
from scripts.website.migrate_thought_documents import verify_relationships
from scripts.website.migration_transfer import pages, project_datasets, transfer
from tests.test_tools_navigation_migration import available_ports, listener
from tests.test_website_legacy_snapshot import configuration, website

from studio.apps.asset_library.migration_blobs import BLOBS
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS as ASSET_MIGRATIONS
from studio.apps.thought_workshop.storage.migrations.registry import (
    MIGRATIONS as THOUGHT_MIGRATIONS,
)
from studio.assembly.independent.asset_library import maintenance as assets
from studio.assembly.independent.thought_workshop.maintenance import DATASETS
from studio.assembly.independent.thought_workshop.maintenance import PREFIX as MIGRATION_PREFIX
from studio.assembly.independent.thought_workshop.maintenance import (
    create_export_app as create_thought_export,
)
from studio.contracts.management.migration_batches import MigrationPlan
from studio.contracts.thought_workshop.migration import PIN_KINDS, ThoughtPinPage, pin_path
from studio.runtime.database.migrations import apply

PREFIX = "/v1/thought-workshop"


def result(response, expected=200):
    assert response.status_code == expected, (
        response.request.method,
        response.request.url.path,
        response.status_code,
        response.text[:500]
        if response.headers.get("content-type", "").startswith("application/json")
        else "",
    )
    return response.json()


def document(text, asset=None):
    content = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
    if asset:
        content.append(
            {"type": "image", "attrs": {"assetId": asset, "width": 320, "alt": "历史素材"}}
        )
    return {"type": "doc", "content": content}


@pytest.fixture(scope="module")
def sealed_thought(tmp_path_factory):
    run = tmp_path_factory.mktemp("sealed-thought", numbered=True)
    runtime = run / "source" / ".runtime"
    runtime.mkdir(parents=True)
    web = run / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><h1>Isolated Thought migration fixture</h1>")
    source_port, restore_port = available_ports()
    key = Fernet.generate_key().decode()
    password = secrets.token_urlsafe(36) + "-Aa9!"
    revision = "a" * 40
    config = configuration(
        run / "source" / "backend" / "config.toml",
        database=runtime / legacy_snapshot.DATABASE,
        key=key,
        port=source_port,
        web=web,
    )
    subprocess.run(
        [sys.executable, "scripts/e2e_account.py"],
        env={
            **{name: value for name, value in os.environ.items() if not name.startswith("FPL_")},
            "FPL_CONFIG_FILE": str(config),
            "FPL_E2E_PASSWORD": password,
        },
        timeout=30,
        check=True,
    )
    png = io.BytesIO()
    Image.new("RGB", (6, 4), "green").save(png, format="PNG")
    content = png.getvalue()
    attachment_bytes = b"Thought sealed rehearsal attachment\n"
    with website(config, source_port) as (client, origin):
        client.timeout = 30
        account = result(
            client.post("/v1/auth/login", json={"username": "e2e-admin", "password": password})
        )["user"]["id"]
        auth = {"Origin": origin, "X-CSRF-Token": client.cookies["fpl_csrf"]}
        asset = result(
            client.post(
                PREFIX + "/images",
                headers=auth,
                files={"upload": ("history.png", content, "image/png")},
            )
        )["asset_id"]
        attachment = result(
            client.post(
                PREFIX + "/attachments",
                headers=auth,
                files={"upload": ("history.txt", attachment_bytes, "text/plain")},
            )
        )["asset_id"]
        cover = result(
            client.post(
                PREFIX + "/images",
                headers=auth,
                files={"upload": ("published-cover.png", content, "image/png")},
            )
        )["asset_id"]
        book = result(
            client.post(
                PREFIX + "/knowledge-bases",
                headers=auth,
                json={"title": "隔离迁移知识库", "cover_asset_id": cover},
            )
        )
        book_path = PREFIX + "/knowledge-bases/" + book["id"]

        def create(title, rich, parent=None, kind="note"):
            current = result(client.get(book_path))
            return result(
                client.post(
                    PREFIX + "/notes",
                    headers=auth,
                    json={
                        "title": title,
                        "document": rich,
                        "knowledge_base_id": book["id"],
                        "expected_knowledge_revision": current["revision"],
                        "parent_id": parent,
                        "kind": kind,
                    },
                )
            )

        original = document("历史文档", asset)
        original["content"].append({"type": "attachment", "attrs": {"assetId": attachment}})
        template = result(
            client.post(
                PREFIX + "/templates",
                headers=auth,
                json={
                    "name": "含附件模板",
                    "document": {"type": "doc", "content": original["content"][-1:]},
                },
            )
        )
        note = create("保留历史引用", original)
        note_path = PREFIX + "/notes/" + note["id"]
        trashed = create("回收站待迁移", document("删除状态和 ID 都需要保留"), note["id"])
        revised = document("当前正文已经移除图片，保留被删除文档的引用")
        revised["content"][0]["content"].append(
            {
                "type": "documentReference",
                "attrs": {"kind": "note", "noteId": trashed["id"], "label": trashed["title"]},
            }
        )
        live = result(
            client.put(
                note_path,
                headers=auth,
                json={
                    "title": note["title"],
                    "knowledge_base_id": book["id"],
                    "expected_revision": note["revision"],
                    "document": revised,
                },
            )
        )
        trash_path = PREFIX + "/notes/" + trashed["id"]
        deleted = result(
            client.delete(
                trash_path,
                headers=auth,
                params={
                    "expected_revision": trashed["revision"],
                    "expected_knowledge_revision": result(client.get(book_path))["revision"],
                },
            )
        )
        assert deleted["deleted_at"]
        data_note = create("迁移多维表", document("保留表格原 ID"), kind="multitable")
        multitable = PREFIX + "/notes/" + data_note["id"] + "/multitable"
        initial_table = result(client.get(multitable))
        table = initial_table["tables"][0]
        first_column = table["fields"][0]["id"]
        table["fields"].extend(
            [
                {
                    "id": "kept-file",
                    "name": "附件",
                    "type": "attachment",
                    "position": len(table["fields"]),
                },
                {
                    "id": "linked-note",
                    "name": "链接",
                    "type": "note",
                    "position": len(table["fields"]) + 1,
                },
            ]
        )
        table_id = table["id"]
        applied = result(
            client.post(
                multitable + "/operations",
                headers=auth,
                json={
                    "expected_revision": initial_table["revision"],
                    "operations": [
                        {"op": "table.put", "table": table},
                        {
                            "op": "records.put",
                            "table_id": table_id,
                            "records": [
                                {
                                    "id": "asset-row",
                                    "position": 0,
                                    "values": {
                                        first_column: "已移除附件",
                                        "kept-file": [attachment],
                                    },
                                },
                                {
                                    "id": "link-row",
                                    "position": 1,
                                    "values": {
                                        first_column: "文档链接",
                                        "linked-note": [note["id"]],
                                    },
                                },
                            ],
                        },
                    ],
                },
            )
        )
        table_revision = applied["structure"]["revision"]
        table_history = result(client.get(f"{multitable}/history/{table_revision}"))
        result(
            client.post(
                multitable + "/operations",
                headers=auth,
                json={
                    "expected_revision": table_revision,
                    "operations": [
                        {"op": "records.delete", "table_id": table_id, "ids": ["asset-row"]}
                    ],
                },
            )
        )
        table_after = result(client.get(multitable))
        member = result(
            client.post(
                "/v1/platform/accounts",
                headers=auth,
                json={
                    "username": "thought-rehearsal-reader",
                    "display_name": "隔离读者",
                },
            ),
            201,
        )["account"]
        publication_path = PREFIX + "/community/libraries/" + book["id"] + "/publication"
        published = result(
            client.put(
                publication_path,
                headers=auth,
                json={
                    "expected_revision": 0,
                    "title": "隔离发布记录",
                    "articles": [
                        {
                            "note_id": note["id"],
                            "expected_revision": 0,
                            "visibility": "members",
                            "members": [{"username": member["username"], "role": "read"}],
                        }
                    ],
                },
            )
        )
        current_book = result(client.get(book_path))
        updated_book = result(
            client.put(
                book_path,
                headers=auth,
                json={
                    "title": current_book["title"],
                    "expected_revision": current_book["revision"],
                    "cover_asset_id": None,
                },
            )
        )
        history_path = note_path + "/history"
        history = result(client.get(history_path))
        history_items = history if isinstance(history, list) else history["items"]
        first = next(row for row in history_items if row["revision"] == note["revision"])
        checkpoint = result(
            client.post(
                note_path + "/checkpoints",
                headers=auth,
                json={
                    "name": "保留历史快照",
                    "history_id": first["id"],
                    "expected_note_revision": live["revision"],
                },
            )
        )
        saved_filter = result(
            client.post(
                PREFIX + "/preferences/filters",
                headers=auth,
                json={
                    "name": "保留个人筛选",
                    "criteria": {"knowledge_base_id": book["id"], "query": "历史"},
                },
            )
        )
        reading = result(
            client.post(
                PREFIX + "/preferences/reading",
                headers=auth,
                json={
                    "resource_id": note["id"],
                    "title": live["title"],
                    "position": {"note_revision": live["revision"], "ratio": 0.37},
                },
            )
        )
        historical = result(client.get(history_path + "/" + first["id"]))
        assert historical["current"]["document"]["content"][1]["attrs"]["assetId"] == asset
        assert client.get(f"/v1/files/{asset}/content").content == content
        assert (
            client.delete(
                f"/v1/files/{asset}",
                headers=auth,
                params={"expected_revision": 0},
            ).status_code
            == 409
        )
        cookies = dict(client.cookies)
    bundle = run / "sealed"
    seal = legacy_snapshot.create(runtime, config, bundle, revision)
    target = run / "restored"
    legacy_snapshot.restore(bundle, target, revision, seal["manifest_sha256"])
    restored = configuration(
        target / "backend" / "verify.toml",
        database=target / ".runtime" / legacy_snapshot.DATABASE,
        key=key,
        port=restore_port,
        web=web,
    )
    with website(restored, restore_port) as (client, _):
        client.timeout = 30
        client.cookies.update(cookies)
        assert result(client.get("/v1/auth/me"))["user"]["id"] == account
        assert result(client.get(note_path)) == live
        assert result(client.get(trash_path)) == deleted
        assert result(client.get(history_path + "/" + first["id"])) == historical
        assert result(client.get(publication_path)) == published
        assert result(client.get(book_path)) == updated_book
        assert result(client.get(multitable)) == table_after
        assert result(client.get(f"{multitable}/history/{table_revision}")) == table_history
        assert result(client.get(note_path + "/checkpoints")) == [checkpoint]
        assert result(client.get(PREFIX + "/preferences/filters")) == [saved_filter]
        assert (
            result(
                client.get(
                    PREFIX + "/preferences/reading",
                    params={"resource_id": note["id"]},
                )
            )
            == reading
        )
        assert result(client.get(PREFIX + "/templates")) == [template]
        assert client.get(f"/v1/files/{attachment}/content").content == attachment_bytes
        assert (
            hashlib.sha256(client.get(f"/v1/files/{asset}/content").content).digest()
            == hashlib.sha256(content).digest()
        )
    return {
        "revision": revision,
        "snapshot": str(bundle),
        "manifest_sha256": seal["manifest_sha256"],
        "owner": account,
        "book_id": book["id"],
        "note_id": note["id"],
        "trashed_id": trashed["id"],
        "table_note_id": data_note["id"],
        "table_id": table_id,
        "article_member_id": member["id"],
        "document_reference_target": trashed["id"],
        "attachment_id": attachment,
        "attachment_sha256": hashlib.sha256(attachment_bytes).hexdigest(),
        "template_id": template["id"],
        "publication_id": published["publication"]["id"],
        "cover_id": cover,
        "cover_sha256": hashlib.sha256(content).hexdigest(),
        "history_id": first["id"],
        "asset_id": asset,
        "asset_sha256": hashlib.sha256(content).hexdigest(),
    }


def test_document_relay_resume_and_verify(tmp_path, sealed_thought):
    fixture = sealed_thought
    owner = UUID(fixture["owner"])
    database = Path(fixture["snapshot"]) / legacy_snapshot.RUNTIME / legacy_snapshot.DATABASE
    token = "isolated-thought-relay-authorization" * 2
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=fixture["revision"],
        source_database_sha256=legacy_snapshot.digest(database),
        owner_ids=(owner, UUID(fixture["article_member_id"])),
        token=token,
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(json.dumps({**plan.model_dump(mode="json"), "token": token}))
    state = tmp_path / "thought"
    apply(state / "service.db", "thought", THOUGHT_MIGRATIONS)
    source_port, target_port = available_ports()
    books, notes, history, *workspace = project_datasets(MIGRATION_PREFIX, DATASETS)

    with (
        httpx.Client(trust_env=False, timeout=10) as client,
        listener(
            client,
            source_port,
            "migration-export",
            plan_file,
            "--legacy-db",
            database,
            module="studio.assembly.independent.thought_workshop.cli",
            prefix=books.prefix,
        ) as source,
    ):

        def open_target():
            return listener(
                client,
                target_port,
                "migration-import",
                plan_file,
                "--state-root",
                state,
                module="studio.assembly.independent.thought_workshop.cli",
                prefix=books.prefix,
            )

        with open_target() as target:
            first = transfer(client, plan, source, target, books)
            assert first["record_count"] == 1
        with open_target() as target:
            assert transfer(client, plan, source, target, books) == first
            assert transfer(client, plan, source, target, notes)["record_count"] == 4
            result = transfer(client, plan, source, target, history)
            assert result["record_count"] >= 1
            assert transfer(client, plan, source, target, history) == result
            state_reports = {
                dataset.name: transfer(client, plan, source, target, dataset)["record_count"]
                for dataset in workspace
            }
            assert state_reports["thought.data-tables"] == 1
            assert state_reports["thought.data-records"] == 1
            assert state_reports["thought.data-assets"] == 1
            assert state_reports["thought.data-changes"] == 3
            assert state_reports["thought.article-members"] == 1
            audit = verify_relationships(client, plan, source, target)
            headers = {"X-Fpl-Migration-Token": token}
            page = next(pages(client, target, headers, plan, owner, notes))
            imported = {item.id: item for item in page.batch.records}
            assert imported[fixture["trashed_id"]].parent_id == fixture["note_id"]
            assert imported[fixture["trashed_id"]].deleted_at
            assert audit["dataset"] == "thought.document-relationships"
            assert audit["record_count"] == 2
            assert audit["file_links"]["table_assets"]["record_count"] == 1


async def reference_pages(client, path, owner, model, headers):
    after = None
    while True:
        response = await client.get(
            f"{path}/{owner}",
            headers=headers,
            params={"after": after} if after is not None else None,
        )
        response.raise_for_status()
        page = model.model_validate_json(response.content)
        assert page.sha256 == page.batch.digest
        yield page
        after = page.next_cursor
        if after is None:
            return


async def test_thought_reference_datasets(tmp_path, sealed_thought):
    marker = sealed_thought
    owner, outsider = UUID(marker["owner"]), uuid4()
    frozen = Path(marker["snapshot"])
    assert legacy_snapshot.digest(frozen / legacy_snapshot.MANIFEST) == marker["manifest_sha256"]
    path = frozen / legacy_snapshot.RUNTIME / legacy_snapshot.DATABASE
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision=marker["revision"],
        source_database_sha256=legacy_snapshot.digest(path),
        owner_ids=(owner, outsider, UUID(marker["article_member_id"])),
        token="thought-complete-projection-fixture-" * 2,
    )
    thought = create_thought_export(plan=plan, source_path=path)
    state = tmp_path / "assets"
    apply(state / "service.db", "assets", ASSET_MIGRATIONS)
    original = assets.create_export_app(plan=plan, source_path=path)
    target = assets.create_import_app(plan=plan, state_root=state)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    expected = {
        "thought.knowledge-base-pins": (marker["book_id"], []),
        "thought.note-pins": (
            marker["note_id"],
            sorted([marker["asset_id"], marker["attachment_id"]]),
        ),
        "thought.template-pins": (marker["template_id"], [marker["attachment_id"]]),
        "thought.publication-pins": (marker["publication_id"], [marker["cover_id"]]),
    }

    async def submit(client, prefix, batch):
        return await client.post(
            prefix + "/batches",
            headers={**headers, "X-Fpl-Migration-SHA256": batch.digest},
            json=batch.model_dump(mode="json"),
        )

    async with (
        original.router.lifespan_context(original),
        target.router.lifespan_context(target),
        thought.router.lifespan_context(thought),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=thought), base_url="http://thought"
        ) as refs,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=original), base_url="http://source"
        ) as old,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=target), base_url="http://target"
        ) as new,
    ):
        for dataset in ASSET_RECORDS:
            async for page in reference_pages(old, dataset.prefix, owner, dataset.page, headers):
                receipt = await submit(new, dataset.prefix, page.batch)
                receipt.raise_for_status()
        source_pages = {}
        for dataset in PIN_KINDS:
            prefix = pin_path(dataset)
            source_pages[dataset] = [
                page async for page in reference_pages(refs, prefix, owner, ThoughtPinPage, headers)
            ]
            identifier, file_ids = expected[dataset]
            selected = next(
                page.batch
                for page in source_pages[dataset]
                if page.batch.records[0].id == identifier
            )
            assert selected.records[0].asset_ids == file_ids
            if dataset == "thought.note-pins":
                retained = next(
                    page.batch.records[0]
                    for page in source_pages[dataset]
                    if page.batch.records[0].id == marker["table_note_id"]
                )
                assert retained.asset_ids == [marker["attachment_id"]]
            if file_ids:
                rejected = await submit(new, prefix, selected)
                assert rejected.status_code == 409
                assert rejected.json()["code"] == "migration_reference_file_unverified"
                foreign = selected.model_copy(update={"owner_id": outsider, "batch_id": uuid4()})
                rejected = await submit(new, prefix, foreign)
                assert rejected.status_code == 409
                assert rejected.json()["code"] == "migration_reference_asset_unavailable"

        listing = await old.get(f"{BLOBS}/{owner}", headers=headers)
        listing.raise_for_status()
        checksums = {blob["id"]: blob["sha256"] for blob in listing.json()}
        assert checksums == {
            marker["asset_id"]: marker["asset_sha256"],
            marker["attachment_id"]: marker["attachment_sha256"],
            marker["cover_id"]: marker["cover_sha256"],
        }
        for asset, digest in checksums.items():
            name = f"{BLOBS}/{owner}/{asset}/{digest}"
            result = await old.get(name, headers=headers)
            result.raise_for_status()
            content = result.content
            wrong = bytes([content[0] ^ 1]) + content[1:]
            rejected = await new.put(name, headers=headers, content=wrong)
            assert rejected.status_code == 409
            saved = await new.put(name, headers=headers, content=content)
            saved.raise_for_status()

        receipts = {}
        for dataset, expected_pages in source_pages.items():
            prefix = pin_path(dataset)
            for page in expected_pages:
                receipt = await submit(new, prefix, page.batch)
                receipt.raise_for_status()
                receipts[page.batch.batch_id] = receipt.json()

    reopened = assets.create_import_app(plan=plan, state_root=state)
    async with (
        reopened.router.lifespan_context(reopened),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=reopened), base_url="http://target"
        ) as new,
    ):
        for dataset, expected_pages in source_pages.items():
            prefix = pin_path(dataset)
            for page in expected_pages:
                replayed = await submit(new, prefix, page.batch)
                assert replayed.json() == receipts[page.batch.batch_id]
            observed = [
                page async for page in reference_pages(new, prefix, owner, ThoughtPinPage, headers)
            ]
            assert observed == expected_pages
