"""Versioned, non-executable infographic scene validation and projections."""

import math
import re
from copy import deepcopy

KINDS = {"rectangle", "rounded", "ellipse", "diamond", "text", "icon", "image", "frame"}
ICONS = {
    "server",
    "database",
    "user",
    "file",
    "cloud",
    "cpu",
    "network",
    "lock",
    "mail",
    "clock",
    "globe",
    "code",
}


def validate_canvas(scene):
    def fail():
        raise ValueError("画板数据无效或版本不支持")

    def text(value):
        return isinstance(value, str) and len(value) <= 5000

    def identifier(value):
        return isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value)

    if (
        not isinstance(scene, dict)
        or set(scene) != {"sceneVersion", "title", "elements", "edges"}
        or type(scene["sceneVersion"]) is not int
        or scene["sceneVersion"] not in {1, 2}
        or not text(scene["title"])
        or not isinstance(scene["elements"], list)
        or not isinstance(scene["edges"], list)
        or len(scene["elements"]) > 1000
        or len(scene["edges"]) > 2000
    ):
        fail()
    elements = {}
    required = {"id", "kind", "x", "y", "width", "height", "text", "fill", "stroke"}
    for item in scene["elements"]:
        if (
            not isinstance(item, dict)
            or not required <= item.keys()
            or set(item)
            - required
            - {"icon", "assetId", "parentId"}
            - ({"fontSize", "textAlign"} if scene["sceneVersion"] == 2 else set())
            or not identifier(item["id"])
            or item["id"] in elements
            or not isinstance(item["kind"], str)
            or item["kind"] not in KINDS
            or not text(item["text"])
        ):
            fail()
        if "fontSize" in item and (
            type(item["fontSize"]) is not int or not 10 <= item["fontSize"] <= 72
        ):
            fail()
        if "textAlign" in item and item["textAlign"] not in ("left", "center", "right"):
            fail()
        for key in ("x", "y", "width", "height"):
            value = item[key]
            if (
                type(value) not in {int, float}
                or abs(value) > 100000
                or not math.isfinite(value)
                or (key in {"width", "height"} and value < 20)
            ):
                fail()
        for key in ("fill", "stroke"):
            if not isinstance(item[key], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", item[key]):
                fail()
        if "icon" in item and (not isinstance(item["icon"], str) or item["icon"] not in ICONS):
            fail()
        if item["kind"] == "image":
            if not isinstance(item.get("assetId"), str) or not 1 <= len(item["assetId"]) <= 500:
                fail()
        elif "assetId" in item:
            fail()
        if "parentId" in item and not identifier(item["parentId"]):
            fail()
        elements[item["id"]] = item
    for item in elements.values():
        if "parentId" in item:
            parent = elements.get(item["parentId"])
            if (
                not parent
                or parent["id"] == item["id"]
                or parent["kind"] != "frame"
                or "parentId" in parent
                or item["kind"] == "frame"
            ):
                fail()
    edges = set()
    for edge in scene["edges"]:
        if (
            not isinstance(edge, dict)
            or not {"id", "source", "target", "label", "arrow", "style"} <= edge.keys()
            or set(edge)
            - {"id", "source", "target", "label", "arrow", "style"}
            - ({"sourceAnchor", "targetAnchor"} if scene["sceneVersion"] == 2 else set())
            or any(
                edge.get(k, default) not in ("left", "right", "top", "bottom")
                for k, default in (("sourceAnchor", "right"), ("targetAnchor", "left"))
            )
            or not identifier(edge["id"])
            or edge["id"] in edges
            or edge["id"] in elements
            or not identifier(edge["source"])
            or not identifier(edge["target"])
            or edge["source"] not in elements
            or edge["target"] not in elements
            or edge["source"] == edge["target"]
            or not text(edge["label"])
            or type(edge["arrow"]) is not bool
            or edge["style"] not in ("straight", "step")
        ):
            fail()
        edges.add(edge["id"])
    return scene


def canvas_text(scene):
    return "\n".join(
        [
            scene["title"],
            *(e["text"] for e in scene["elements"]),
            *(e["label"] for e in scene["edges"]),
        ]
    )


def canvas_assets(scene):
    return {e["assetId"] for e in scene["elements"] if e["kind"] == "image"}


def remap_canvas(scene, mapping):
    result = deepcopy(scene)
    for element in result["elements"]:
        if element["kind"] == "image":
            element["assetId"] = mapping[element["assetId"]]
    return result
