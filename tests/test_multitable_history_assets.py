"""Removed attachment fields remain restorable through a complete backup."""

import io
import zipfile

import httpx
import pytest
from tests.test_thought_multitable import ROOT, row, setup

from website_test_support import app


@pytest.mark.asyncio
async def test_historical_attachment_retention_backup_remapping_and_restore():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        note, base, _, table = await setup(c)
        content = b"attachment retained only in table history"
        upload = await c.post(
            ROOT + "/attachments", files={"upload": ("history.txt", content, "text/plain")}
        )
        assert upload.status_code == 200, upload.text
        asset = upload.json()["asset_id"]
        table["fields"].append(
            {"id": "historical-attachment", "name": "附件", "type": "attachment", "position": 4}
        )
        record = row(table, "historical-asset-record")
        record["values"]["historical-attachment"] = [asset]
        saved = await c.post(
            base + "/operations",
            json={
                "expected_revision": 0,
                "operations": [
                    {"op": "table.put", "table": table},
                    {"op": "records.put", "table_id": table["id"], "records": [record]},
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        table["fields"].pop()
        removed = await c.post(
            base + "/operations",
            json={"expected_revision": 1, "operations": [{"op": "table.put", "table": table}]},
        )
        assert removed.status_code == 200, removed.text
        assert (
            await c.delete(f"/v1/files/{asset}", params={"expected_revision": 0})
        ).status_code == 409
        backup = await c.get(
            ROOT + "/backup", params={"knowledge_base_id": note["knowledge_base_id"]}
        )
        assert backup.status_code == 200, backup.text
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            assert archive.read("assets/" + asset) == content
        imported = await c.post(
            ROOT + "/imports", files={"upload": ("backup.zip", backup.content, "application/zip")}
        )
        assert imported.status_code == 200, imported.text
        for id in imported.json()["note_ids"]:
            restored_note = (await c.get(ROOT + f"/notes/{id}")).json()
            if restored_note["kind"] != "multitable":
                continue
            restored_base = ROOT + f"/notes/{id}/multitable"
            history = (await c.get(restored_base + "/history/1")).json()
            restored_table = history["tables"][0]
            field = next(f for f in restored_table["fields"] if f["type"] == "attachment")
            new_asset = history["records"][restored_table["id"]][0]["values"][field["id"]][0]
            assert field["id"] != "historical-attachment" and new_asset != asset
            restored = await c.post(
                restored_base + "/history/1/restore", json={"expected_revision": 2}
            )
            assert restored.status_code == 200, restored.text
            assert restored.json()["structure"]["revision"] == 3
            assert (await c.get(f"/v1/files/{new_asset}/download")).content == content
