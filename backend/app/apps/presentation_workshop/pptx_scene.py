"""Native groups, preset connectors and editable routed paths for PowerPoint."""

import math

from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu, Pt

SITES = {"top": 0, "left": 1, "bottom": 2, "right": 3}


def px(value):
    return Emu(round(value * 9525))


def anchor(item, side):
    x = item.x + (0 if side == "left" else item.width if side == "right" else item.width / 2)
    y = item.y + (0 if side == "top" else item.height if side == "bottom" else item.height / 2)
    angle = math.radians(item.rotation)
    cx, cy = item.x + item.width / 2, item.y + item.height / 2
    return (
        cx + (x - cx) * math.cos(angle) - (y - cy) * math.sin(angle),
        cy + (x - cx) * math.sin(angle) + (y - cy) * math.cos(angle),
    )


def add_scene(slide, page, shapes):
    elements = {e.id: e for e in page.elements}
    connection_shapes = {}
    for edge in page.connections:
        start = anchor(elements[edge.source_id], edge.source_anchor)
        end = anchor(elements[edge.target_id], edge.target_anchor)
        routed = bool(edge.waypoints and edge.style == "step")
        line = (
            _routed_shape(slide, [start, *((p.x, p.y) for p in edge.waypoints), end])
            if routed
            else slide.shapes.add_connector(
                MSO_CONNECTOR.ELBOW if edge.style == "step" else MSO_CONNECTOR.STRAIGHT,
                px(start[0]),
                px(start[1]),
                px(end[0]),
                px(end[1]),
            )
        )
        line.name = edge.id
        line.line.color.rgb = RGBColor.from_string(edge.color[1:])
        line.line.width = Pt(edge.width * 0.75)
        if not routed:
            for binding_name, identity, side in (
                ("stCxn", edge.source_id, edge.source_anchor),
                ("endCxn", edge.target_id, edge.target_anchor),
            ):
                target = elements[identity]
                shape = shapes[identity]
                _connection_sites(shape, target)
                if target.flip_x:
                    side = {"left": "right", "right": "left"}.get(side, side)
                if target.flip_y:
                    side = {"top": "bottom", "bottom": "top"}.get(side, side)
                binding = OxmlElement(f"a:{binding_name}")
                binding.set("id", str(shape.shape_id))
                binding.set("idx", str(SITES[side]))
                line._element.nvCxnSpPr.cNvCxnSpPr.append(binding)
        if edge.arrow:
            arrow = OxmlElement("a:tailEnd")
            arrow.set("type", "triangle")
            line._element.spPr.get_or_add_ln().append(arrow)
        parts = [line]
        if edge.label:
            points = [start, *((p.x, p.y) for p in edge.waypoints), end]
            if edge.style == "step" and not edge.waypoints:
                if edge.source_anchor in {"top", "bottom"}:
                    y = (start[1] + end[1]) / 2
                    points = [start, (start[0], y), (end[0], y), end]
                else:
                    x = (start[0] + end[0]) / 2
                    points = [start, (x, start[1]), (x, end[1]), end]
            midpoint = _midpoint(points)
            label = slide.shapes.add_textbox(
                px(midpoint[0] - 90), px(midpoint[1] - 28), px(180), px(28)
            )
            label.name = edge.id + "-label"
            label.text = edge.label
            label.text_frame.paragraphs[0].font.size = Pt(12)
            label.text_frame.paragraphs[0].font.name = "Microsoft YaHei"
            label.text_frame.paragraphs[0].font.color.rgb = RGBColor.from_string(edge.color[1:])
            parts.append(label)
        connection_shapes[edge.id] = parts

    groups = {g.id: g for g in page.groups}
    ownership = {identity: g.id for g in page.groups for identity in g.element_ids}

    def ancestors(identity):
        current = ownership.get(identity)
        result = []
        while current:
            result.append(current)
            current = groups[current].parent_id
        return result

    edges_by_group = {}
    for edge in page.connections:
        targets = set(ancestors(edge.target_id))
        owner = next((g for g in ancestors(edge.source_id) if g in targets), None)
        edges_by_group.setdefault(owner, []).extend(connection_shapes[edge.id])

    def assemble(group):
        members = [shapes[i] for i in group.element_ids]
        members += [assemble(g) for g in page.groups if g.parent_id == group.id]
        members += edges_by_group.get(group.id, [])
        result = slide.shapes.add_group_shape(members)
        result.name = group.id
        return result

    for group in page.groups:
        if group.parent_id is None:
            assemble(group)


def _midpoint(points):
    lengths = [math.dist(a, b) for a, b in zip(points[:-1], points[1:], strict=True)]
    remaining = sum(lengths) / 2
    for index, length in enumerate(lengths):
        if remaining <= length:
            ratio = remaining / length if length else 0
            a, b = points[index : index + 2]
            return a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio
        remaining -= length
    return points[-1]


def _connection_sites(shape, item):
    """Give custom outlines the same four explicit ports as the editor."""
    properties = shape._element.spPr
    geometry = properties.find(qn("a:custGeom"))
    if geometry is None and item.kind in {"triangle", "diamond", "arrow"}:
        w, h = item.width, item.height
        points = {
            "triangle": [(w / 2, 0), (w, h), (0, h)],
            "diamond": [(w / 2, 0), (w, h / 2), (w / 2, h), (0, h / 2)],
            "arrow": [
                (0, h * 0.25),
                (w * 0.65, h * 0.25),
                (w * 0.65, 0),
                (w, h / 2),
                (w * 0.65, h),
                (w * 0.65, h * 0.75),
                (0, h * 0.75),
            ],
        }[item.kind]
        geometry = OxmlElement("a:custGeom")
        for name in ("avLst", "gdLst", "ahLst", "cxnLst"):
            geometry.append(OxmlElement(f"a:{name}"))
        path_list = OxmlElement("a:pathLst")
        path = OxmlElement("a:path")
        path.set("w", str(px(w)))
        path.set("h", str(px(h)))
        for index, (x, y) in enumerate(points):
            command = OxmlElement("a:moveTo" if index == 0 else "a:lnTo")
            point = OxmlElement("a:pt")
            point.set("x", str(px(x)))
            point.set("y", str(px(y)))
            command.append(point)
            path.append(command)
        path.append(OxmlElement("a:close"))
        path_list.append(path)
        geometry.append(path_list)
        properties.replace(properties.find(qn("a:prstGeom")), geometry)
    if geometry is None:
        return
    sites = geometry.find(qn("a:cxnLst"))
    if sites is None:
        sites = OxmlElement("a:cxnLst")
        geometry.insert(3, sites)
    if len(sites):
        return
    for angle, x, y in (
        (16200000, "wd2", "0"),
        (10800000, "0", "hd2"),
        (5400000, "wd2", "h"),
        (0, "w", "hd2"),
    ):
        site = OxmlElement("a:cxn")
        site.set("ang", str(angle))
        point = OxmlElement("a:pos")
        point.set("x", x)
        point.set("y", y)
        site.append(point)
        sites.append(site)


def _routed_shape(slide, points):
    """PowerPoint requires freeform paths in p:sp, not p:cxnSp.

    The latter passes the general shape-properties XSD but makes PowerPoint
    repair the containing slide. Keep the exact route as one editable shape.
    """
    left, top = min(p[0] for p in points), min(p[1] for p in points)
    width = max(1, max(p[0] for p in points) - left)
    height = max(1, max(p[1] for p in points) - top)
    shape = slide.shapes.add_shape(
        MSO_AUTO_SHAPE_TYPE.RECTANGLE, px(left), px(top), px(width), px(height)
    )
    shape.fill.background()
    shape._element.remove(shape._element.find(qn("p:style")))
    geometry = OxmlElement("a:custGeom")
    for name in ("avLst", "gdLst", "ahLst", "cxnLst"):
        geometry.append(OxmlElement(f"a:{name}"))
    rect = OxmlElement("a:rect")
    for key, value in (("l", "0"), ("t", "0"), ("r", "r"), ("b", "b")):
        rect.set(key, value)
    geometry.append(rect)
    paths = OxmlElement("a:pathLst")
    path = OxmlElement("a:path")
    path.set("w", str(px(width)))
    path.set("h", str(px(height)))
    path.set("fill", "none")
    for index, (x, y) in enumerate(points):
        command = OxmlElement("a:moveTo" if index == 0 else "a:lnTo")
        point = OxmlElement("a:pt")
        point.set("x", str(px(x - left)))
        point.set("y", str(px(y - top)))
        command.append(point)
        path.append(command)
    paths.append(path)
    geometry.append(paths)
    properties = shape._element.spPr
    properties.replace(properties.prstGeom, geometry)
    properties.append(OxmlElement("a:effectLst"))
    return shape
