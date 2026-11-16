"""Isolated durable storage verifies races, replay, ownership and originals."""

import asyncio

import pytest

from studio.apps.spreadsheet_workshop.schemas import (
    SpreadsheetCreate,
    SpreadsheetError,
    SpreadsheetExport,
    SpreadsheetImportConfirm,
    SpreadsheetOperations,
    SpreadsheetPut,
)
from studio.apps.spreadsheet_workshop.storage.files import Originals
from studio.apps.spreadsheet_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.spreadsheet_workshop.storage.models import MODELS
from studio.apps.spreadsheet_workshop.storage.records import Records
from studio.apps.spreadsheet_workshop.use_cases import Workbooks
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.revisions import RevisionConflictError


@pytest.fixture
async def records(tmp_path):
    apply(tmp_path / "service.db", "spreadsheet", MIGRATIONS)
    database = Database("spreadsheet", tmp_path, models=MODELS)
    records = Records(database.sessions, Originals(tmp_path))
    await records.recover()
    yield records
    await database.close()


async def test_owner_isolation_replay_conflict_and_atomic_edits(records):
    create = SpreadsheetCreate(request_id="create", title="预算")
    project = await records.create("alice", create)
    assert (await records.create("alice", create)).id == project.id
    assert (await records.list("bob", "", 0, 30)).total == 0
    assert "document" not in (await records.list("alice", "", 0, 30)).items[0].model_dump()
    with pytest.raises(SpreadsheetError, match="不可访问"):
        await records.get("bob", project.id)
    with pytest.raises(SpreadsheetError, match="request_id"):
        await records.create("alice", SpreadsheetCreate(request_id="create", title="不同输入"))
    edit = SpreadsheetOperations(
        request_id="op",
        expected_revision=0,
        operations=[
            {
                "action": "set_cells",
                "sheet_id": "sheet-1",
                "cells": [
                    {"r": 0, "c": 0, "v": {"v": 10}},
                    {"r": 1, "c": 0, "v": {"f": "=SUM(A1,5)"}},
                ],
            }
        ],
    )
    edited = await records.operations("alice", project.id, edit)
    assert edited.revision == 1 and edited.calculation == "pending"
    assert (await records.operations("alice", project.id, edit)) == edited
    with pytest.raises(RevisionConflictError):
        await records.put(
            "alice",
            project.id,
            SpreadsheetPut(
                request_id="stale", expected_revision=0, title="覆盖", document=project.document
            ),
        )
    invalid = SpreadsheetOperations(
        request_id="invalid",
        expected_revision=1,
        operations=[
            {
                "action": "set_cells",
                "sheet_id": "sheet-1",
                "cells": [{"r": 0, "c": 0, "v": {"v": 99}}],
            },
            {"action": "delete_sheet", "sheet_id": "sheet-1"},
        ],
    )
    with pytest.raises(SpreadsheetError, match="最后"):
        await records.operations("alice", project.id, invalid)
    assert (await records.get("alice", project.id)).document.sheets[0].celldata[0].v["v"] == 10
    books = Workbooks(records)
    selected = await books.read_range("alice", project.id, "sheet-1", "A1:A2")
    assert selected.cells[1].formula == "=SUM(A1,5)"
    assert selected.cells[1].calculation == "pending"
    with pytest.raises(SpreadsheetError, match="尚未重算"):
        await books.export(
            "alice", project.id, SpreadsheetExport(expected_revision=1, format="csv")
        )
    await records.delete("alice", project.id, 1, "delete")
    assert await records.delete("alice", project.id, 1, "delete") == {"deleted": True}


async def test_parallel_cas_does_not_overwrite(records):
    project = await records.create("alice", SpreadsheetCreate(request_id="create"))

    async def write(name):
        return await records.put(
            "alice",
            project.id,
            SpreadsheetPut(
                request_id=name, expected_revision=0, title=name, document=project.document
            ),
        )

    result = await asyncio.gather(write("first"), write("second"), return_exceptions=True)
    assert sum(not isinstance(item, Exception) for item in result) == 1
    assert any(isinstance(item, RevisionConflictError) for item in result)
    assert (await records.get("alice", project.id)).revision == 1


async def test_parallel_same_request_replays_without_duplicate_creation(records):
    body = SpreadsheetCreate(request_id="concurrent-create")
    first, second = await asyncio.gather(
        records.create("alice", body), records.create("alice", body)
    )
    assert first.id == second.id
    assert (await records.list("alice", "", 0, 30)).total == 1
    deleted = await asyncio.gather(
        records.delete("alice", first.id, 0, "concurrent-delete"),
        records.delete("alice", first.id, 0, "concurrent-delete"),
    )
    assert deleted == [{"deleted": True}, {"deleted": True}]


async def test_compact_format_expansion_is_rejected_before_allocating_cells(records):
    project = await records.create("alice", SpreadsheetCreate(request_id="create"))
    with pytest.raises(SpreadsheetError, match="工作量"):
        await records.operations(
            "alice",
            project.id,
            SpreadsheetOperations(
                request_id="expanded",
                expected_revision=0,
                operations=[
                    {
                        "action": "style_range",
                        "sheet_id": "sheet-1",
                        "range": "A1:Z100",
                        "style": {"ct": {"fa": "x" * 9000}},
                    }
                ],
            ),
        )
    with pytest.raises(SpreadsheetError, match="工作簿格式无效"):
        await records.operations(
            "alice",
            project.id,
            SpreadsheetOperations(
                request_id="invalid-name",
                expected_revision=0,
                operations=[
                    {"action": "rename_sheet", "sheet_id": "sheet-1", "name": "invalid/name"}
                ],
            ),
        )
    assert (await records.get("alice", project.id)).revision == 0


async def test_import_original_recovery_and_cross_owner_confirmation(records):
    content = '名称,内容\n甲,"换行\n内容"'.encode()
    preview = await records.preview("alice", "原件.csv", content, "utf-8-sig")
    confirm = SpreadsheetImportConfirm(
        request_id="confirm", sha256=preview.sha256, converter=preview.converter
    )
    with pytest.raises(SpreadsheetError):
        await records.confirm("bob", preview.id, confirm)
    project = await records.confirm("alice", preview.id, confirm)
    assert (await records.confirm("alice", preview.id, confirm)).id == project.id
    path, name = await records.original("alice", project.id)
    assert path.read_bytes() == content and name == "原件.csv"
    orphan = records.originals.write(b"uncommitted")
    await records.recover()
    assert path.read_bytes() == content
    assert not records.originals.path(orphan).exists()
    with pytest.raises(SpreadsheetError):
        await records.original("bob", project.id)


async def test_sheet_rename_updates_quoted_references_and_delete_marks_ref(records):
    project = await records.create("alice", SpreadsheetCreate(request_id="create"))
    updated = await records.operations(
        "alice",
        project.id,
        SpreadsheetOperations(
            request_id="sheets",
            expected_revision=0,
            operations=[
                {"action": "add_sheet", "sheet_id": "report", "name": "汇总"},
                {
                    "action": "set_cells",
                    "sheet_id": "report",
                    "cells": [{"r": 0, "c": 0, "v": {"f": "='工作表1'!A1+1"}}],
                },
                {"action": "rename_sheet", "sheet_id": "sheet-1", "name": "销售'数据"},
            ],
        ),
    )
    assert updated.document.sheets[1].celldata[0].v["f"] == "='销售''数据'!A1+1"
    updated = await records.operations(
        "alice",
        project.id,
        SpreadsheetOperations(
            request_id="delete-sheet",
            expected_revision=1,
            operations=[{"action": "delete_sheet", "sheet_id": "sheet-1"}],
        ),
    )
    assert updated.document.sheets[0].celldata[0].v["f"] == "=#REF!+1"
