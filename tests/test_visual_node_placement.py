import json
from pathlib import Path

import pytest

from app.apps.visual_workshop.node_placement import NODE_SIZE, automatic_node_position

FIXTURE = json.loads((Path(__file__).parent / "fixtures/visual_node_placement.json").read_text())


def test_card_sizes_match_browser_fixture():
    assert NODE_SIZE == FIXTURE["sizes"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_browser_placement_parity(case):
    assert automatic_node_position(case["nodes"], case["kind"], case["anchor"]) == case["expected"]


def test_dense_region_falls_back_without_mutating_existing_nodes():
    nodes = [
        {"kind": "image", "position": {"x": x * 352, "y": y * 246}}
        for x in range(-10, 11)
        for y in range(-10, 11)
    ]
    point = automatic_node_position(nodes, "image", {"x": 0, "y": 0})
    assert point == {"x": 10 * 352 + 320 + 32, "y": 0}
    assert nodes[0]["position"] == {"x": -3520, "y": -2460}


def test_nonfinite_anchor_rejected():
    with pytest.raises(ValueError, match="坐标范围"):
        automatic_node_position([], "image", {"x": float("nan"), "y": 0})
