import copy
import json
import sqlite3
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import httpx
import pytest
from pydantic import ValidationError
from tests.presentation_helpers import sample_document

from db.migrations.versions.r0099_presentation_lists import SQL
from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.schemas.document import (
    PresentationDocument,
    PresentationParagraph,
)
from website_test_support import app


def list_document():
    document = sample_document().model_dump()
    item = document["slides"][0]["elements"][0]
    base = item["paragraphs"][0]
    item["paragraphs"] = [
        {**copy.deepcopy(base), "bullet": bullet, "numbered": numbered}
        for bullet, numbered in [
            (False, True),
            (False, True),
            (True, False),
            (False, True),
            (False, False),
        ]
    ]
    return document


def test_list_migration_preserves_bullets_order_explicit_values_and_metadata(tmp_path):
    document = list_document()
    for paragraph in document["slides"][0]["elements"][0]["paragraphs"]:
        if not paragraph["numbered"]:
            paragraph.pop("numbered")
    for page in document["slides"][1:]:
        for item in page["elements"]:
            for paragraph in item["paragraphs"]:
                paragraph.pop("numbered")
    document["slides"].append({"id": "empty", "elements": []})
    with sqlite3.connect(tmp_path / "lists.db") as connection:
        connection.execute(
            "CREATE TABLE presentation_projects(document JSON, revision INT, updated_at TEXT)"
        )
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, 7, 'original')", (json.dumps(document),)
        )
        connection.executescript(SQL)
        row = connection.execute("SELECT * FROM presentation_projects").fetchone()
        expected = copy.deepcopy(document)
        for page in expected["slides"]:
            for item in page["elements"]:
                for paragraph in item["paragraphs"]:
                    paragraph.setdefault("numbered", False)
        assert json.loads(row[0]) == expected
        assert row[1:] == (7, "original")
        connection.executescript(SQL)
        assert connection.execute("SELECT * FROM presentation_projects").fetchone() == row


def test_legacy_bullets_default_to_unnumbered_and_conflicting_markers_are_rejected():
    paragraph = sample_document().slides[0].elements[0].paragraphs[0].model_dump()
    paragraph.pop("numbered")
    paragraph["bullet"] = True
    assert not PresentationParagraph.model_validate(paragraph).numbered
    with pytest.raises(ValidationError, match="不能同时"):
        PresentationParagraph.model_validate({**paragraph, "numbered": True})


async def test_lists_roundtrip_through_project_api_and_cas():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/presentation-workshop/projects",
            json={"title": "列表", "document": list_document()},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        route = f"/v1/presentation-workshop/projects/{project['id']}"
        assert (await client.get(route)).json()["document"] == project["document"]
        payload = {
            "title": "列表",
            "document": project["document"],
            "expected_revision": project["revision"],
        }
        payload["document"]["slides"][0]["elements"][0]["paragraphs"][0].update(
            bullet=True, numbered=False
        )
        saved = await client.put(route, json=payload)
        assert saved.status_code == 200, saved.text
        assert saved.json()["document"] == payload["document"]
        assert (await client.put(route, json=payload)).status_code == 409
        payload["expected_revision"] = saved.json()["revision"]
        payload["document"]["slides"][0]["elements"][0]["paragraphs"][0]["numbered"] = True
        assert (await client.put(route, json=payload)).status_code == 422


def test_pptx_has_native_decimal_numbering_restarts_and_bullets(tmp_path):
    target = tmp_path / "lists.pptx"
    data = list_document()
    data["slides"][0]["elements"][0]["paragraphs"][1]["runs"][0]["text"] = "第二项\n同项续行"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    properties = root.findall(".//a:pPr", ns)
    assert [
        p.find("a:buAutoNum", ns).get("startAt")
        for p in properties
        if p.find("a:buAutoNum", ns) is not None
    ] == ["1", None, "1"]
    assert all(p.get("type") == "arabicPeriod" for p in root.findall(".//a:buAutoNum", ns))
    assert properties[2].find("a:buChar", ns).get("char") == "•"
    assert properties[4].find("a:buNone", ns) is not None
    assert properties[0].get("marL") == str(36 * 2 * 9525)
    paragraphs = root.findall(".//a:p", ns)
    assert len(paragraphs) == 5
    assert len(paragraphs[1].findall("a:br", ns)) == 1
    assert [node.text for node in paragraphs[1].findall("a:r/a:t", ns)] == ["第二项", "同项续行"]
