from __future__ import annotations

import asyncio
import io
from contextlib import aclosing
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.integrations.external.contracts import (
    ConnectionCredentials,
    ExternalError,
    document_target,
)
from app.integrations.external.feishu import FeishuClient
from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.thought_workshop.external_sync.content import project_content
from studio.apps.thought_workshop.external_sync.models import ArticleSyncTask
from studio.apps.thought_workshop.external_sync.runner import ArticleSyncRunner


class FakeFeishu:
    def __init__(self):
        self.id = "d" + uuid4().hex
        self.revision = 1
        self.blocks = [
            {"block_id": self.id, "block_type": 1, "children": ["old"]},
            {
                "block_id": "old",
                "block_type": 2,
                "text": {"elements": [{"text_run": {"content": "远端原正文"}}]},
            },
        ]
        self.writes = []
        self.token_requests = 0
        self.writable = True
        self.wiki_type = "docx"
        self.wiki_tokens: list[str] = []
        self.hosts: set[str] = set()
        self.fail_token = False
        self.read_code: int | None = None
        self.timeout_after_append = False
        self.edit_after_append = False
        self.transport = httpx.MockTransport(self.handle)

    @property
    def url(self):
        return "https://demo.feishu.cn/docx/" + self.id

    def edit(self, text="他人在飞书修改"):
        self.blocks[1]["text"]["elements"][0]["text_run"]["content"] = text
        self.revision += 1

    def handle(self, request):
        path = request.url.path
        self.hosts.add(request.url.host)
        if path.endswith("/get_node"):
            self.wiki_tokens.append(request.url.params.get("token", ""))
            if self.wiki_type == "denied":
                return httpx.Response(400, json={"code": 131006, "msg": "provider secret"})
            if self.wiki_type == "scope":
                return httpx.Response(400, json={"code": 99991672, "msg": "provider secret"})
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "node": {
                            "obj_type": self.wiki_type,
                            "obj_token": self.id,
                            "title": "飞书原标题",
                        }
                    },
                },
            )
        if path.endswith("/tenant_access_token/internal"):
            self.token_requests += 1
            if self.fail_token:
                return httpx.Response(200, json={"code": 10003, "msg": "secret should never leak"})
            return httpx.Response(
                200, json={"code": 0, "tenant_access_token": "test-token", "expire": 3600}
            )
        if (
            request.method == "GET"
            and self.read_code
            and "/documents/" in path
            and not path.endswith("/blocks")
        ):
            return httpx.Response(403, json={"code": self.read_code, "msg": "provider secret"})
        if "/permissions/" in path:
            data = {"auth_result": self.writable}
        elif request.method == "GET" and path.endswith("/blocks"):
            data = {"items": deepcopy(self.blocks), "has_more": False}
        elif request.method == "GET":
            data = {
                "document": {
                    "document_id": self.id,
                    "title": "飞书原标题",
                    "revision_id": self.revision,
                }
            }
        elif path.endswith("/descendant"):
            import json

            body = json.loads(request.content)
            self.writes.append("append")
            ids = {b["block_id"]: "b" + uuid4().hex for b in body["descendants"]}
            for block in body["descendants"]:
                row = deepcopy(block)
                row["block_id"] = ids[block["block_id"]]
                if "children" in row:
                    row["children"] = [ids[id] for id in row["children"]]
                self.blocks.append(row)
            self.blocks[0]["children"].extend(ids[id] for id in body["children_id"])
            self.revision += 1
            data = {
                "block_id_relations": [
                    {"temporary_block_id": a, "block_id": b} for a, b in ids.items()
                ],
                "document_revision_id": self.revision,
            }
            if self.edit_after_append:
                self.edit()
            if self.timeout_after_append:
                raise httpx.ReadTimeout("ambiguous", request=request)
        elif path.endswith("/upload_all"):
            self.writes.append("upload")
            data = {"file_token": "image-token"}
        elif request.method == "PATCH":
            import json

            body = json.loads(request.content)
            id = path.rsplit("/", 1)[1]
            block = next(b for b in self.blocks if b["block_id"] == id)
            block["image"] = {"token": body["replace_image"]["token"]}
            self.writes.append("image")
            self.revision += 1
            data = {"document_revision_id": self.revision}
        elif request.method == "DELETE":
            import json

            body = json.loads(request.content)
            self.writes.append("delete")
            roots = self.blocks[0]["children"]
            removed = set(roots[body["start_index"] : body["end_index"]])
            while True:
                descendants = {
                    c
                    for b in self.blocks
                    if b["block_id"] in removed
                    for c in b.get("children", [])
                }
                if descendants <= removed:
                    break
                removed |= descendants
            self.blocks = [b for b in self.blocks if b["block_id"] not in removed]
            self.blocks[0]["children"] = roots[body["end_index"] :]
            self.revision += 1
            data = {"document_revision_id": self.revision}
        else:
            raise AssertionError((request.method, path))
        return httpx.Response(200, json={"code": 0, "data": data})


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [[], {"code": 0, "data": []}, "provider diagnostic secret"])
async def test_malformed_feishu_response_is_safe_provider_error(payload):
    def handle(request):
        if request.url.path.endswith("/tenant_access_token/internal"):
            return httpx.Response(
                200, json={"code": 0, "tenant_access_token": "test-token", "expire": 3600}
            )
        return httpx.Response(200, json=payload)

    client = FeishuClient(
        ConnectionCredentials("cli_test", "test-secret"), httpx.MockTransport(handle)
    )
    with pytest.raises(ExternalError, match="飞书返回了无效响应") as result:
        await client.request("GET", "/docx/v1/documents/test")
    assert result.value.status == 502
    assert "secret" not in str(result.value)


@pytest.mark.asyncio
async def test_malformed_feishu_token_rejected_before_document_request():
    requests = []

    def handle(request):
        requests.append(request.url.path)
        return httpx.Response(
            200, json={"code": 0, "tenant_access_token": {"secret": "diagnostic"}, "expire": "bad"}
        )

    client = FeishuClient(
        ConnectionCredentials("cli_test", "test-secret"), httpx.MockTransport(handle)
    )
    with pytest.raises(ExternalError, match="飞书鉴权未返回访问凭证") as result:
        await client.request("GET", "/docx/v1/documents/test")
    assert result.value.status == 502
    assert len(requests) == 1


@pytest.fixture
def remote(monkeypatch):
    remote = FakeFeishu()
    original = FeishuClient.__init__
    monkeypatch.setattr(
        FeishuClient,
        "__init__",
        lambda self, credentials, transport=None: original(
            self, credentials, remote.transport if transport is None else transport
        ),
    )
    return remote


@pytest.fixture
async def client():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


async def setup_article(client, remote, document=None):
    conn = await client.post(
        "/v1/integrations/external-connections",
        json={"name": uuid4().hex, "app_id": "cli_test", "app_secret": "never-return-me"},
    )
    assert conn.status_code == 201, conn.text
    assert "never-return-me" not in conn.text
    conn = conn.json()
    library = await client.post("/v1/thought-workshop/knowledge-bases", json={"title": uuid4().hex})
    assert library.status_code == 200, library.text
    note = await client.post(
        "/v1/thought-workshop/notes",
        json={
            "knowledge_base_id": library.json()["id"],
            "expected_knowledge_revision": library.json()["revision"],
            "title": "本地文章",
            "document": document
            or {
                "type": "doc",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "本地正文"}]}
                ],
            },
        },
    )
    assert note.status_code == 200, note.text
    note = note.json()
    prefix = f"/v1/thought-workshop/notes/{note['id']}/external-sync"
    binding = await client.put(
        prefix + "/binding",
        json={"connection_id": conn["id"], "url": remote.url, "expected_revision": 0},
    )
    assert binding.status_code == 200, binding.text
    return conn, note, prefix, binding.json()


async def submit_preview(client, prefix, note, binding):
    preview = await client.post(
        prefix + "/preview",
        json={"expected_revision": note["revision"], "binding_revision": binding["revision"]},
    )
    assert preview.status_code == 200, preview.text
    preview = preview.json()
    body = {
        "preview_id": preview["preview_id"],
        "operation_id": str(uuid4()),
        "confirm_replace": True,
    }
    submitted = await client.post(prefix + "/tasks", json=body)
    assert submitted.status_code == 202, submitted.text
    return submitted.json(), body


async def allowed(*_args):
    return True


@pytest.mark.asyncio
async def test_sync_end_to_end_idempotency_and_detach(client, remote):
    _, note, prefix, binding = await setup_article(client, remote)
    task, body = await submit_preview(client, prefix, note, binding)
    repeated = await client.post(prefix + "/tasks", json=body)
    assert repeated.json()["id"] == task["id"]
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).process_once()
    result = (await client.get(prefix)).json()
    assert result["tasks"][0]["status"] == "succeeded", result
    assert result["binding"]["last_note_revision"] == note["revision"]
    assert remote.writes == ["append", "delete"]
    assert all(b["block_id"] != "old" for b in remote.blocks)
    detail = (await client.get(prefix + "/tasks/" + task["id"])).json()
    assert [s["status"] for s in detail["steps"]] == ["confirmed", "confirmed"]
    assert (
        await client.delete(prefix + "/binding", params={"expected_revision": binding["revision"]})
    ).status_code == 204
    assert remote.writes == ["append", "delete"]


@pytest.mark.asyncio
async def test_remote_change_requires_fresh_confirmation(client, remote):
    _, note, prefix, binding = await setup_article(client, remote)
    preview = (
        await client.post(
            prefix + "/preview",
            json={"expected_revision": note["revision"], "binding_revision": binding["revision"]},
        )
    ).json()
    remote.edit()
    result = await client.post(
        prefix + "/tasks",
        json={
            "preview_id": preview["preview_id"],
            "operation_id": str(uuid4()),
            "confirm_replace": True,
        },
    )
    assert result.status_code == 409
    assert remote.writes == []
    task, _ = await submit_preview(client, prefix, note, binding)
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).process_once()
    assert (await client.get(prefix + "/tasks/" + task["id"])).json()["status"] == "succeeded"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout_after_append", "edit_after_append"])
async def test_partial_write_never_replays_or_deletes_old(client, remote, failure):
    from tests.thought_helpers import delete_note

    conn, note, prefix, binding = await setup_article(client, remote)
    setattr(remote, failure, True)
    task, _ = await submit_preview(client, prefix, note, binding)
    runner = ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal)
    await runner.process_once()
    state = (await client.get(prefix)).json()
    assert state["tasks"][0]["status"] == "needs_review", state
    assert remote.writes == ["append"]
    assert any(b["block_id"] == "old" for b in remote.blocks)
    await runner.recover()
    await runner.process_once()
    assert remote.writes == ["append"]
    assert (
        await client.delete(prefix + "/binding", params={"expected_revision": binding["revision"]})
    ).status_code == 409
    retry = await client.post(prefix + "/tasks/" + task["id"] + "/reconcile", json={})
    assert retry.status_code == 200, retry.text
    assert retry.json()["can_resume"] is False
    assert remote.writes == ["append"]
    path = "/v1/thought-workshop/notes/" + note["id"]
    trashed = await delete_note(client, path, params={"expected_revision": note["revision"]})
    assert trashed.status_code == 200, trashed.text
    purged = await delete_note(
        client, path, params={"expected_revision": trashed.json()["revision"], "permanent": True}
    )
    assert purged.status_code == 409, purged.text
    assert "外部同步" in purged.text
    await client.patch(
        "/v1/integrations/external-connections/" + conn["id"],
        json={
            "name": conn["name"],
            "app_id": conn["app_id"],
            "enabled": False,
            "expected_revision": conn["revision"],
        },
    )
    ended = await client.post(
        prefix + "/tasks/" + task["id"] + "/reconcile", json={"acknowledge_partial": True}
    )
    assert ended.status_code == 200
    assert ended.json()["task"]["status"] == "failed"
    assert (
        await delete_note(
            client,
            path,
            params={"expected_revision": trashed.json()["revision"], "permanent": True},
        )
    ).status_code == 200
    assert remote.writes == ["append"]


@pytest.mark.asyncio
async def test_connection_disabled_and_permission_revoked_before_run(client, remote):
    conn, note, prefix, binding = await setup_article(client, remote)
    task, _ = await submit_preview(client, prefix, note, binding)
    response = await client.patch(
        "/v1/integrations/external-connections/" + conn["id"],
        json={
            "name": conn["name"],
            "app_id": conn["app_id"],
            "enabled": False,
            "expected_revision": conn["revision"],
        },
    )
    assert response.status_code == 200, response.text
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).process_once()
    assert (await client.get(prefix + "/tasks/" + task["id"])).json()["status"] == "failed"
    assert remote.writes == []


@pytest.mark.asyncio
async def test_global_target_uniqueness_and_connection_cas(client, remote):
    conn, _, _, _ = await setup_article(client, remote)
    update = {"name": conn["name"], "app_id": conn["app_id"], "expected_revision": 0}
    assert (
        await client.patch("/v1/integrations/external-connections/" + conn["id"], json=update)
    ).status_code == 200
    assert (
        await client.patch("/v1/integrations/external-connections/" + conn["id"], json=update)
    ).status_code == 409
    library = (
        await client.post("/v1/thought-workshop/knowledge-bases", json={"title": uuid4().hex})
    ).json()
    note = (
        await client.post(
            f"/v1/thought-workshop/knowledge-bases/{library['id']}/documents",
            json={"title": "第二篇", "expected_revision": library["revision"]},
        )
    ).json()
    result = await client.put(
        f"/v1/thought-workshop/notes/{note['id']}/external-sync/binding",
        json={"connection_id": conn["id"], "url": remote.url, "expected_revision": 0},
    )
    assert result.status_code == 409


@pytest.mark.asyncio
async def test_auth_error_is_redacted_and_permission_check_separate(client, remote):
    conn, _, _, _ = await setup_article(client, remote)
    remote.fail_token = True
    checked = await client.post(f"/v1/integrations/external-connections/{conn['id']}/check")
    assert checked.status_code == 200
    assert checked.json()["status"] == "failed"
    assert "secret should never leak" not in checked.text


@pytest.mark.asyncio
async def test_embedded_multitable_previews_as_a_static_table(client, remote):
    library = await client.post("/v1/thought-workshop/knowledge-bases", json={"title": uuid4().hex})
    assert library.status_code == 200, library.text
    library = library.json()
    table_note = await client.post(
        "/v1/thought-workshop/notes",
        json={
            "knowledge_base_id": library["id"],
            "expected_knowledge_revision": library["revision"],
            "title": "调研台账",
            "kind": "multitable",
        },
    )
    assert table_note.status_code == 200, table_note.text
    table_note = table_note.json()
    base = f"/v1/thought-workshop/notes/{table_note['id']}/multitable"
    table = (await client.get(base)).json()["tables"][0]
    saved = await client.post(
        base + "/operations",
        json={
            "expected_revision": table_note["revision"],
            "operations": [
                {
                    "op": "records.put",
                    "table_id": table["id"],
                    "records": [
                        {
                            "id": uuid4().hex,
                            "position": 0,
                            "values": {table["fields"][0]["id"]: "比较结果"},
                        }
                    ],
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    _, note, prefix, binding = await setup_article(
        client,
        remote,
        {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "正文说明"}]},
                {
                    "type": "multitableView",
                    "attrs": {
                        "noteId": table_note["id"],
                        "tableId": table["id"],
                        "viewId": table["views"][0]["id"],
                    },
                },
            ],
        },
    )
    preview = await client.post(
        prefix + "/preview",
        json={"expected_revision": note["revision"], "binding_revision": binding["revision"]},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["blockers"] == []
    assert body["preview_id"]
    assert "比较结果" in body["local_text"]
    assert "正文说明" in body["local_text"]
    assert any("普通表格" in warning for warning in body["warnings"])
    tables = [block for block in body["snapshot"] if block["kind"] == "table"]
    assert tables
    assert any(
        run["text"] == "比较结果"
        for row in tables[0]["rows"]
        for cell in row
        for block in cell
        for run in block["runs"]
    )


def test_content_projection_blockers_inline_and_style_warnings():
    content = project_content(
        "标题",
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": "正文",
                            "marks": [{"type": "textStyle", "attrs": {"color": "red"}}],
                        },
                        {"type": "inlineMath", "attrs": {"latex": "x"}},
                    ],
                }
            ],
        },
    )
    assert any("公式" in message for message in content["blockers"])
    assert content["warnings"]
    assert "正文" in content["text"]


@pytest.mark.parametrize(
    "url",
    [
        "http://demo.feishu.cn/docx/a",
        "https://evil.com/docx/a",
        "https://demo.feishu.cn/docs/a",
        "https://demo.feishu.cn/wiki/a/extra",
        "https://demo.feishu.cn.evil.com/docx/a",
        "https://user@demo.feishu.cn/docx/a",
        "https://demo.feishu.cn:8443/docx/a",
        "https://demo.feishu.cn:invalid/docx/a",
        "https://[invalid/docx/a",
    ],
)
def test_target_url_is_identifier_not_outbound_destination(url):
    with pytest.raises(ExternalError):
        document_target(url)


def test_wiki_and_docx_links_keep_only_the_document_identifier():
    wiki = document_target(
        "https://my.feishu.cn/wiki/YdxcwJ8tolY8qPkOa3Pctfqknnc?create_from=create_doc_to_wiki&from=wiki"
    )
    assert (wiki.kind, wiki.token, wiki.url) == (
        "wiki",
        "YdxcwJ8tolY8qPkOa3Pctfqknnc",
        "https://my.feishu.cn/wiki/YdxcwJ8tolY8qPkOa3Pctfqknnc",
    )
    docx = document_target("https://demo.feishu.cn/docx/abc/")
    assert (docx.kind, docx.token, docx.url) == (
        "docx",
        "abc",
        "https://demo.feishu.cn/docx/abc",
    )


@pytest.mark.asyncio
async def test_runner_recovery_only_marks_running_jobs(client, remote):
    _, note, prefix, binding = await setup_article(client, remote)
    task, _ = await submit_preview(client, prefix, note, binding)
    async with SessionLocal() as session:
        row = await session.scalar(select(ArticleSyncTask).where(ArticleSyncTask.id == task["id"]))
        row.status = "running"
        await session.commit()
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).recover()
    assert (await client.get(prefix)).json()["tasks"][0]["status"] == "needs_review"
    assert remote.writes == []


@pytest.mark.asyncio
async def test_recovery_continues_only_confirmed_steps_without_reappending(client, remote):
    _, note, prefix, binding = await setup_article(client, remote)
    task, _ = await submit_preview(client, prefix, note, binding)
    interrupted = ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal)
    finish = interrupted.finish_step

    async def stop_after_confirming(*args):
        await finish(*args)
        raise asyncio.CancelledError()

    interrupted.finish_step = stop_after_confirming
    with pytest.raises(asyncio.CancelledError):
        await interrupted.process_once()
    assert remote.writes == ["append"]
    await interrupted.recover()
    resumed = await client.post(prefix + "/tasks/" + task["id"] + "/reconcile", json={})
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["can_resume"] is True
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).process_once()
    assert remote.writes == ["append", "delete"]
    assert (await client.get(prefix + "/tasks/" + task["id"])).json()["status"] == "succeeded"


@pytest.mark.asyncio
async def test_source_version_changes_require_new_preview_and_sync_keeps_queued_snapshot(
    client, remote
):
    _, note, prefix, binding = await setup_article(client, remote)
    preview = (
        await client.post(
            prefix + "/preview",
            json={"expected_revision": note["revision"], "binding_revision": binding["revision"]},
        )
    ).json()
    path = "/v1/thought-workshop/notes/" + note["id"]
    updated = await client.put(
        path,
        json={
            "expected_revision": note["revision"],
            "title": "更新标题",
            "knowledge_base_id": note["knowledge_base_id"],
            "document": note["document"],
            "tags": [],
        },
    )
    assert updated.status_code == 200, updated.text
    stale = await client.post(
        prefix + "/tasks",
        json={
            "preview_id": preview["preview_id"],
            "operation_id": str(uuid4()),
            "confirm_replace": True,
        },
    )
    assert stale.status_code == 409
    note = updated.json()
    task, _ = await submit_preview(client, prefix, note, binding)
    updated = await client.put(
        path,
        json={
            "expected_revision": note["revision"],
            "title": "继续本地编辑",
            "knowledge_base_id": note["knowledge_base_id"],
            "document": note["document"],
            "tags": [],
        },
    )
    assert updated.status_code == 200, updated.text
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).process_once()
    state = (await client.get(prefix)).json()
    assert state["tasks"][0]["status"] == "succeeded", state
    assert state["binding"]["last_note_revision"] == note["revision"] < updated.json()["revision"]
    assert (await client.get(prefix + "/tasks/" + task["id"])).json()["note_revision"] == note[
        "revision"
    ]
    remote_text = "".join(
        e["text_run"]["content"]
        for b in remote.blocks
        for value in b.values()
        if isinstance(value, dict)
        for e in value.get("elements", [])
    )
    assert "更新标题" in remote_text and "继续本地编辑" not in remote_text


@pytest.mark.asyncio
async def test_images_and_tables_verified_before_old_body_removed(client, remote):
    image = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(image, format="PNG")
    uploaded = await client.post(
        "/v1/thought-workshop/images",
        files={"upload": ("small.png", image.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    paragraph = {
        "type": "paragraph",
        "content": [{"type": "text", "text": "单元格", "marks": [{"type": "bold"}]}],
    }
    document = {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {"assetId": uploaded.json()["asset_id"], "caption": "图片说明"},
            },
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableCell", "content": [paragraph]},
                            {"type": "tableCell", "content": [{"type": "paragraph"}]},
                        ],
                    }
                ],
            },
        ],
    }
    _, note, prefix, binding = await setup_article(client, remote, document)
    task, _ = await submit_preview(client, prefix, note, binding)
    await ArticleSyncRunner(allowed, remote.transport, sessions=SessionLocal).process_once()
    result = (await client.get(prefix + "/tasks/" + task["id"])).json()
    assert result["status"] == "succeeded", result
    assert remote.writes == ["append", "upload", "image", "delete"]
    assert [s["status"] for s in result["steps"]] == ["confirmed"] * 4
    assert any(b.get("image", {}).get("token") == "image-token" for b in remote.blocks)
    assert any(b["block_type"] == 31 for b in remote.blocks)
    assert not any(b["block_id"] == "old" for b in remote.blocks)
    # Shared API test database: release this test's article/history image references.
    from tests.thought_helpers import delete_note

    path = "/v1/thought-workshop/notes/" + note["id"]
    assert (
        await delete_note(client, path, params={"expected_revision": note["revision"]})
    ).status_code == 200
    trashed = (await client.get(path)).json()
    assert (
        await delete_note(
            client, path, params={"expected_revision": trashed["revision"], "permanent": True}
        )
    ).status_code == 200
    assert (
        await client.delete(
            "/v1/files/" + uploaded.json()["asset_id"], params={"expected_revision": 0}
        )
    ).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["actor", "target", "trash"])
async def test_authorization_and_article_state_checked_at_execution(client, remote, reason):
    from tests.thought_helpers import delete_note

    _, note, prefix, binding = await setup_article(client, remote)
    task, _ = await submit_preview(client, prefix, note, binding)

    async def revoked(*_args):
        return False

    if reason == "target":
        remote.writable = False
    if reason == "trash":
        deleted = await delete_note(
            client,
            "/v1/thought-workshop/notes/" + note["id"],
            params={"expected_revision": note["revision"]},
        )
        assert deleted.status_code == 200, deleted.text
    await ArticleSyncRunner(
        revoked if reason == "actor" else allowed, remote.transport, sessions=SessionLocal
    ).process_once()
    assert (await client.get(prefix + "/tasks/" + task["id"])).json()["status"] == "failed"
    assert remote.writes == []


@pytest.mark.asyncio
async def test_invalid_link_returns_validation_error_without_network(client, remote):
    conn, _, _, _ = await setup_article(client, remote)
    requests = remote.token_requests
    result = await client.post(
        f"/v1/integrations/external-connections/{conn['id']}/target-check",
        json={"url": "https://evil.test/docx/abc"},
    )
    assert result.status_code == 422, result.text
    assert "知识库中的 /wiki/ 节点" in result.json()["detail"]
    assert remote.token_requests == requests


@pytest.mark.asyncio
async def test_wiki_link_resolves_to_docx_and_binds_that_document(client, remote):
    conn, _, prefix, binding = await setup_article(client, remote)
    wiki = (
        "https://my.feishu.cn/wiki/YdxcwJ8tolY8qPkOa3Pctfqknnc"
        "?create_from=create_doc_to_wiki&from=wiki"
    )
    checked = await client.post(
        f"/v1/integrations/external-connections/{conn['id']}/target-check", json={"url": wiki}
    )
    assert checked.status_code == 200, checked.text
    assert checked.json()["document_id"] == remote.id
    assert checked.json()["url"] == f"https://my.feishu.cn/docx/{remote.id}"
    assert checked.json()["can_write"] is True
    assert remote.hosts == {"open.feishu.cn"}
    assert remote.wiki_tokens == ["YdxcwJ8tolY8qPkOa3Pctfqknnc"]
    assert (
        await client.delete(prefix + "/binding", params={"expected_revision": binding["revision"]})
    ).status_code == 204
    rebound = await client.put(
        prefix + "/binding",
        json={"connection_id": conn["id"], "url": wiki, "expected_revision": 0},
    )
    assert rebound.status_code == 200, rebound.text
    assert rebound.json()["url"] == f"https://my.feishu.cn/docx/{remote.id}"


@pytest.mark.asyncio
@pytest.mark.parametrize("wiki_type", ["sheet", "denied", "scope"])
async def test_wiki_link_rejects_non_docx_nodes_without_leaking_provider_text(
    client, remote, wiki_type
):
    conn, _, _, _ = await setup_article(client, remote)
    remote.wiki_type = wiki_type
    result = await client.post(
        f"/v1/integrations/external-connections/{conn['id']}/target-check",
        json={"url": "https://my.feishu.cn/wiki/YdxcwJ8tolY8qPkOa3Pctfqknnc"},
    )
    body = result.json()
    if wiki_type == "sheet":
        assert result.status_code == 422, result.text
        assert "不是新版文档" in body["detail"]
    elif wiki_type == "scope":
        assert result.status_code == 502, result.text
        assert body["code"] == "wiki_scope_required"
        assert "99991672" in body["detail"]
        assert "查看知识空间节点信息" in body["detail"]
    else:
        assert result.status_code == 502, result.text
        assert body["code"] == "wiki_node_forbidden"
        assert "131006" in body["detail"]
        assert "添加文档应用" in body["detail"]
    assert "provider secret" not in result.text
    assert "never-return-me" not in result.text


@pytest.mark.asyncio
async def test_document_read_forbidden_explains_how_to_add_the_app(client, remote):
    conn, _, _, _ = await setup_article(client, remote)
    remote.read_code = 1770032
    result = await client.post(
        f"/v1/integrations/external-connections/{conn['id']}/target-check",
        json={"url": "https://my.feishu.cn/wiki/P79mwdka1XSQMkxNPncqmE0nsh"},
    )
    body = result.json()
    assert result.status_code == 502, result.text
    assert body["code"] == "document_forbidden"
    assert "1770032" in body["detail"]
    assert "添加文档应用" in body["detail"]
    assert "查看、评论、编辑和管理云文档" in body["detail"]
    assert "provider secret" not in result.text


@pytest.mark.asyncio
async def test_expired_token_refreshes_once_and_ambiguous_write_never_retries():
    counts = {"token": 0, "write": 0}

    def handle(request):
        if request.url.path.endswith("/internal"):
            counts["token"] += 1
            return httpx.Response(
                200, json={"code": 0, "tenant_access_token": f"t-{counts['token']}", "expire": 3600}
            )
        counts["write"] += 1
        if counts["write"] == 1:
            return httpx.Response(200, json={"code": 99991663})
        raise httpx.ReadTimeout("unknown write result", request=request)

    client = FeishuClient(
        ConnectionCredentials("cli_test", "test-secret"), httpx.MockTransport(handle)
    )
    with pytest.raises(httpx.ReadTimeout):
        await client.request("POST", "/docx/test")
    assert counts == {"token": 2, "write": 2}


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_connections_bindings_and_jobs_are_workspace_scoped(remote):
    from tests.test_workspace_governance import client_account

    owner, _, _, _ = await client_account()
    other, _, _, _ = await client_account()
    async with aclosing(owner), aclosing(other):
        conn, note, prefix, binding = await setup_article(owner, remote)
        task, _ = await submit_preview(owner, prefix, note, binding)
        assert (await other.get("/v1/integrations/external-connections")).json()["items"] == []
        assert (
            await other.post(f"/v1/integrations/external-connections/{conn['id']}/check")
        ).status_code == 404
        assert (await other.get(prefix)).status_code == 404
        assert (await other.get(prefix + "/tasks/" + task["id"])).status_code == 404
        from app.console.governance.external_sync_access import external_sync_actor_allowed

        await ArticleSyncRunner(
            external_sync_actor_allowed, remote.transport, sessions=SessionLocal
        ).process_once()
        assert (await owner.get(prefix + "/tasks/" + task["id"])).json()["status"] == "succeeded"


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_other_account_cannot_sync_and_disabled_owner_stops_queued_job(remote):
    from tests.test_workspace_governance import client_account

    from app.console.governance.external_sync_access import external_sync_actor_allowed

    owner, _, owner_id, _ = await client_account()
    other, *_ = await client_account()
    admin, *_ = await client_account(admin=True)
    async with aclosing(owner), aclosing(other), aclosing(admin):
        _, note, prefix, binding = await setup_article(owner, remote)
        assert (await other.get(prefix)).status_code == 404
        task, _ = await submit_preview(owner, prefix, note, binding)
        rows = (await admin.get("/v1/platform/accounts")).json()["items"]
        account = next(row for row in rows if row["id"] == owner_id)
        disabled = await admin.patch(
            "/v1/platform/accounts/" + owner_id,
            json={"status": "disabled", "expected_revision": account["revision"]},
        )
        assert disabled.status_code == 200, disabled.text
        await ArticleSyncRunner(
            external_sync_actor_allowed, remote.transport, sessions=SessionLocal
        ).process_once()
        async with SessionLocal() as session:
            current = await session.get(ArticleSyncTask, task["id"])
            assert current.status == "failed"
        assert remote.writes == []


@pytest.mark.asyncio
async def test_backup_import_and_copy_do_not_inherit_external_binding(client, remote):
    _, note, prefix, _ = await setup_article(client, remote)
    root = "/v1/thought-workshop"
    snapshot = (await client.get(root + f"/notes/{note['id']}/copy-snapshot")).json()
    duplicate = await client.post(
        root + f"/notes/{note['id']}/duplicate",
        json={
            "knowledge_base_id": note["knowledge_base_id"],
            "source_knowledge_revision": snapshot["knowledge_revision"],
            "expected_knowledge_revision": snapshot["knowledge_revision"],
            "expected_revisions": snapshot["revisions"],
        },
    )
    assert duplicate.status_code == 200, duplicate.text
    copy_prefix = root + f"/notes/{duplicate.json()['root_id']}/external-sync"
    assert (await client.get(copy_prefix)).json() == {"binding": None, "tasks": []}
    backup = await client.get(
        root + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
    )
    assert backup.status_code == 200, backup.text
    imported = await client.post(
        root + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
    )
    assert imported.status_code == 200, imported.text
    for id in imported.json()["note_ids"]:
        assert (await client.get(root + f"/notes/{id}/external-sync")).json() == {
            "binding": None,
            "tasks": [],
        }
    assert (await client.get(prefix)).json()["binding"]
