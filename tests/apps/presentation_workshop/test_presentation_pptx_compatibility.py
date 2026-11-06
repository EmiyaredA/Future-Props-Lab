"""Check DrawingML constraints that permissive python-pptx loading misses."""

from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from studio.apps.presentation_workshop.pptx_export import write_pptx
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from tests.presentation_helpers import element, sample_document

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


@pytest.mark.parametrize("notes", ["", "中文备注\n\nSecond paragraph & <references>"])
def test_notes_master_is_registered_and_shared_by_all_notes_slides(tmp_path, notes):
    document = sample_document()
    for page in document.slides:
        page.notes = notes
    target = tmp_path / "notes.pptx"
    write_pptx(document, {}, target)
    relationship_ns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
    office_rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/presentation.xml"))
        masters = root.find("p:notesMasterIdLst", NS)
        assert len(masters) == 1
        master_id = masters[0].get(f"{{{office_rel_ns}}}id")
        relationships = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
        master_rels = [
            rel for rel in relationships if rel.get("Type") == office_rel_ns + "/notesMaster"
        ]
        assert len(master_rels) == 1
        assert master_rels[0].get("Id") == master_id
        master_target = master_rels[0].get("Target")
        assert "ppt/" + master_target in archive.namelist()
        # CT_Presentation declares notes master IDs before slide IDs and sizes.
        children = list(root)
        assert children.index(masters) < children.index(root.find("p:sldIdLst", NS))
        for index in range(1, len(document.slides) + 1):
            rels = ET.fromstring(archive.read(f"ppt/notesSlides/_rels/notesSlide{index}.xml.rels"))
            master = next(
                rel
                for rel in rels.findall("r:Relationship", relationship_ns)
                if rel.get("Type") == office_rel_ns + "/notesMaster"
            )
            assert master.get("Target") == "../" + master_target
    assert [slide.notes_slide.notes_text_frame.text for slide in Presentation(target).slides] == [
        notes
    ] * len(document.slides)


@pytest.mark.parametrize("reverse", [False, True])
def test_routed_path_is_editable_freeform_and_preserves_route(tmp_path, reverse):
    data = sample_document().model_dump()
    page = data["slides"][0]
    page["elements"] = [
        element("rect", id="a", x=100, y=100, width=200, height=100),
        element("rect", id="b", x=800, y=300, width=200, height=100),
    ]
    page["groups"] = [{"id": "group", "name": "Flow", "element_ids": ["a", "b"]}]
    page["connections"] = [
        {
            "id": "edge",
            "source_id": "b" if reverse else "a",
            "target_id": "a" if reverse else "b",
            "source_anchor": "left" if reverse else "right",
            "target_anchor": "right" if reverse else "left",
            "style": "step",
            "color": "#2877DA",
            "width": 2,
            "arrow": True,
            "label": "Route",
            "waypoints": [{"x": 650, "y": 350 if reverse else 150}],
        }
    ]
    target = tmp_path / "route.pptx"
    write_pptx(PresentationDocument.model_validate(data), {}, target)
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    group = root.find(".//p:grpSp", NS)
    route = next(
        s for s in group.findall("p:sp", NS) if s.find("p:nvSpPr/p:cNvPr", NS).get("name") == "edge"
    )
    assert root.find(".//p:cxnSp", NS) is None
    properties = route.find("p:spPr", NS)
    # CT_ShapeProperties sequence: transform, geometry, fill, line, effects.
    assert [child.tag.rsplit("}", 1)[-1] for child in properties] == [
        "xfrm",
        "custGeom",
        "noFill",
        "ln",
        "effectLst",
    ]
    assert properties.find("a:ln/a:solidFill/a:srgbClr", NS).get("val") == "2877DA"
    assert properties.find("a:ln", NS).get("w") == str(2 * 9525)
    assert properties.find("a:ln/a:tailEnd", NS).get("type") == "triangle"
    assert properties.find("a:prstGeom", NS) is None
    geometry = properties.find("a:custGeom", NS)
    assert geometry.find("a:pathLst/a:path", NS).get("fill") == "none"
    points = geometry.findall(".//a:pt", NS)
    assert [(int(p.get("x")), int(p.get("y"))) for p in points] == [
        (500 * 9525, 200 * 9525) if reverse else (0, 0),
        (350 * 9525, 200 * 9525) if reverse else (350 * 9525, 0),
        (0, 0) if reverse else (500 * 9525, 200 * 9525),
    ]
    assert root.find(".//a:stCxn", NS) is None
    assert root.find(".//a:endCxn", NS) is None
    assert route.find("p:style", NS) is None
    assert geometry.find("a:pathLst/a:path/a:close", NS) is None
    reloaded = Presentation(target)
    loaded_group = next(s for s in reloaded.slides[0].shapes if s.name == "group")
    assert (
        next(s for s in loaded_group.shapes if s.name == "edge").shape_type
        == MSO_SHAPE_TYPE.FREEFORM
    )
    assert "Route" in [t.text for t in root.findall(".//a:t", NS)]


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("arrow", [False, True])
@pytest.mark.parametrize(
    "points,source_anchor,target_anchor",
    [
        ([(300, 150), (650, 150), (650, 350), (800, 350)], "right", "left"),
        ([(300, 150), (650, 150), (800, 150)], "right", "left"),
        ([(200, 200), (200, 400), (200, 500)], "bottom", "top"),
        ([(300, 150), (300, 150), (300, 150)], "right", "left"),
    ],
    ids=["multiple-bends", "horizontal", "vertical", "coincident"],
)
def test_routed_paths_preserve_absolute_points_in_nested_groups(
    tmp_path, points, source_anchor, target_anchor, arrow, reverse
):
    points = list(reversed(points)) if reverse else points
    source_anchor, target_anchor = (
        (target_anchor, source_anchor) if reverse else (source_anchor, target_anchor)
    )

    def node(identity, point, side):
        x = point[0] - {"left": 0, "right": 200, "top": 100, "bottom": 100}[side]
        y = point[1] - {"left": 50, "right": 50, "top": 0, "bottom": 100}[side]
        return element("rect", id=identity, x=x, y=y, width=200, height=100)

    data = sample_document().model_dump()
    page = data["slides"][0]
    page["elements"] = [node("a", points[0], source_anchor), node("b", points[-1], target_anchor)]
    page["groups"] = [
        {"id": "outer", "name": "Outer", "element_ids": ["b"]},
        {"id": "inner", "name": "Inner", "element_ids": ["a"], "parent_id": "outer"},
    ]
    page["connections"] = [
        {
            "id": "route",
            "source_id": "a",
            "target_id": "b",
            "source_anchor": source_anchor,
            "target_anchor": target_anchor,
            "style": "step",
            "arrow": arrow,
            "label": "折线路径",
            "waypoints": [{"x": x, "y": y} for x, y in points[1:-1]],
        }
    ]
    # A native connector on another page must keep its endpoint bindings.
    native_page = data["slides"][1]
    native_page["connections"] = [
        {
            "id": "native",
            "source_id": "shape-one",
            "target_id": "text-two",
            "style": "straight",
        }
    ]
    document = PresentationDocument.model_validate(data)
    before = document.model_dump_json()
    target = tmp_path / "mixed.pptx"
    write_pptx(document, {}, target)
    assert document.model_dump_json() == before
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
        native = ET.fromstring(archive.read("ppt/slides/slide2.xml"))
    outer = root.find("p:cSld/p:spTree/p:grpSp", NS)
    assert outer.find("p:grpSp", NS) is not None
    route = next(
        s
        for s in outer.findall("p:sp", NS)
        if s.find("p:nvSpPr/p:cNvPr", NS).get("name") == "route"
    )
    properties = route.find("p:spPr", NS)
    offset = properties.find("a:xfrm/a:off", NS)
    actual = [
        (int(p.get("x")) + int(offset.get("x")), int(p.get("y")) + int(offset.get("y")))
        for p in properties.findall("a:custGeom/a:pathLst/a:path/*/a:pt", NS)
    ]
    assert actual == [(x * 9525, y * 9525) for x, y in points]
    assert all(int(v) > 0 for v in properties.find("a:xfrm/a:ext", NS).attrib.values())
    assert properties.find("a:noFill", NS) is not None
    assert (properties.find("a:ln/a:tailEnd", NS) is not None) == arrow
    assert root.find(".//p:cxnSp", NS) is None
    assert "折线路径" in [t.text for t in outer.findall("p:sp/p:txBody/a:p/a:r/a:t", NS)]
    assert native.find(".//p:cxnSp/p:spPr/a:prstGeom", NS).get("prst") == "line"
    assert native.find(".//a:stCxn", NS) is not None
    assert native.find(".//a:endCxn", NS) is not None
    loaded = Presentation(target)
    assert len(loaded.slides) == 3
    assert [s.notes_slide.notes_text_frame.text for s in loaded.slides] == [
        s.notes for s in document.slides
    ]


def test_transparent_vector_effect_precedes_svg_extension_and_keeps_fallback(tmp_path):
    from PIL import Image

    image = tmp_path / "vector.png"
    Image.new("RGBA", (24, 24), "red").save(image)
    image.with_suffix(".svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<path fill="#123456" d="M0 0 L24 0 L12 24 Z"/></svg>'
    )
    data = sample_document().model_dump()
    data["slides"][0]["elements"] = [
        element("vector", asset_id="vector", opacity=0.5, vector_color="#FF0000")
    ]
    target = tmp_path / "vector.pptx"
    write_pptx(PresentationDocument.model_validate(data), {"vector": image}, target)
    with ZipFile(target) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
        assert any(n.endswith(".png") for n in archive.namelist())
        assert any(n.endswith(".svg") for n in archive.namelist())
    blip = root.find(".//a:blip", NS)
    # CT_Blip permits effects first and an optional terminal extension list.
    assert [child.tag.rsplit("}", 1)[-1] for child in blip] == ["alphaModFix", "extLst"]
    assert blip.find("a:alphaModFix", NS).get("amt") == "50000"
    assert blip.find("a:extLst/a:ext", NS) is not None
