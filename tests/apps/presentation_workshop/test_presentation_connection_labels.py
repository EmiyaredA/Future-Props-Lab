import json
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest
from pydantic import ValidationError

from studio.apps.presentation_workshop.connection_labels import label_layout
from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.schemas.scene import PresentationConnection
from tests.apps.presentation_workshop.test_presentation_scene import scene_document

VECTORS = json.loads(
    (Path(__file__).parents[2] / "fixtures/presentation_connection_labels.json").read_text()
)
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["name"])
def test_label_layout_matches_web(vector):
    assert (
        label_layout(
            vector["points"],
            vector["label"],
            vector.get("position"),
            vector.get("offset"),
            vector.get("font_size", 16),
        )
        == vector["expected"]
    )


def test_label_defaults_are_additive_and_coordinates_are_validated():
    old = {"id": "e", "source_id": "a", "target_id": "b", "label": "旧文字"}
    edge = PresentationConnection.model_validate(old)
    assert edge.label_position is None and edge.label_offset is None
    assert edge.label_font_size is None and edge.arrow_size is None
    assert old == {"id": "e", "source_id": "a", "target_id": "b", "label": "旧文字"}
    for value in (-0.1, 1.1, float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            PresentationConnection.model_validate({**old, "label_position": value})
    with pytest.raises(ValidationError):
        PresentationConnection.model_validate({**old, "label_offset": {"x": 10001, "y": 0}})
    value = {**old, "label_position": 0.25, "label_offset": {"x": 4, "y": -30}}
    assert PresentationConnection.model_validate(value).model_dump()["label_offset"] == {
        "x": 4,
        "y": -30,
    }
    for size in (5, 73, float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            PresentationConnection.model_validate({**old, "label_font_size": size})
    with pytest.raises(ValidationError):
        PresentationConnection.model_validate({**old, "arrow_size": "tiny"})


def test_actual_pptx_label_is_editable_masked_and_above_all_paths(tmp_path):
    data = scene_document()
    page = data["slides"][0]
    page["connections"][0].update(
        label="校验失败\n有界恢复", label_position=0.25, label_offset={"x": 25, "y": 20}
    )
    page["connections"].append(
        {"id": "later", "source_id": "node-b", "target_id": "label-a", "layer": 3}
    )
    target = tmp_path / "labels.pptx"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    label = next(
        s
        for s in root.findall(".//p:sp", NS)
        if s.find("p:nvSpPr/p:cNvPr", NS).get("name") == "edge-label"
    )
    assert [n.text for n in label.findall(".//a:t", NS)] == ["校验失败", "有界恢复"]
    assert label.find("p:spPr/a:solidFill/a:srgbClr", NS).get("val") == page["background"][1:]
    assert label.find("p:txBody/a:bodyPr", NS).get("wrap") == "none"
    assert root.find("p:cSld/p:spTree", NS)[-1] is label
    assert label.find(".//a:defRPr", NS).get("sz") == "1200"


@pytest.mark.parametrize("size,xml_size", [("small", "sm"), ("medium", "med"), ("large", "lg")])
def test_small_label_and_arrow_sizes_survive_native_export(tmp_path, size, xml_size):
    data = scene_document()
    data["slides"][0]["connections"][0].update(label_font_size=10, arrow_size=size)
    target = tmp_path / "sized.pptx"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    arrow = root.find(".//a:tailEnd", NS)
    assert arrow.get("w") == xml_size and arrow.get("len") == xml_size
    label = next(
        s
        for s in root.findall(".//p:sp", NS)
        if s.find("p:nvSpPr/p:cNvPr", NS).get("name") == "edge-label"
    )
    assert label.find(".//a:defRPr", NS).get("sz") == "750"
