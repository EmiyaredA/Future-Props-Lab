"""Native groups, preset connectors and editable routed paths for PowerPoint."""

from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE, MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Emu, Pt

from studio.apps.presentation_workshop.connection_labels import label_layout
from studio.apps.presentation_workshop.connection_routes import anchor as route_anchor

SITES = {"top": 0, "left": 1, "bottom": 2, "right": 3}


def px(value):
    return Emu(round(value * 9525))


def anchor(item, side, offset=0.5):
    point = route_anchor(item.model_dump(), side, offset)
    return point["x"], point["y"]


def add_scene(slide, page, shapes):
    elements = {e.id: e for e in page.elements}
    connection_shapes = {}
    labels = []
    for edge in page.connections:
        start = (
            (edge.source_point.x, edge.source_point.y)
            if edge.source_point
            else anchor(elements[edge.source_id], edge.source_anchor, edge.source_offset)
        )
        end = (
            (edge.target_point.x, edge.target_point.y)
            if edge.target_point
            else anchor(elements[edge.target_id], edge.target_anchor, edge.target_offset)
        )
        points = [start, *((p.x, p.y) for p in edge.waypoints if edge.style != "straight"), end]
        if edge.style == "step" and not edge.waypoints:
            if edge.source_anchor in {"top", "bottom"}:
                y = (start[1] + end[1]) / 2
                points = [start, (start[0], y), (end[0], y), end]
            else:
                x = (start[0] + end[0]) / 2
                points = [start, (x, start[1]), (x, end[1]), end]
        routed = (
            bool(edge.waypoints and edge.style != "straight")
            or edge.source_offset != 0.5
            or edge.target_offset != 0.5
        )
        line = (
            _routed_shape(slide, points)
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
        # Preset theme effects must not add shadows absent from the SVG canvas.
        for style in list(line._element.findall(qn("p:style"))):
            line._element.remove(style)
        if line._element.spPr.find(qn("a:effectLst")) is None:
            line._element.spPr.append(OxmlElement("a:effectLst"))
        line.line.color.rgb = RGBColor.from_string(edge.color[1:])
        line.line.width = Pt(edge.width * 0.75)
        if not routed:
            for binding_name, identity, side in (
                ("stCxn", edge.source_id, edge.source_anchor),
                ("endCxn", edge.target_id, edge.target_anchor),
            ):
                if identity is None:
                    continue
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
            if edge.arrow_size:
                size = {"small": "sm", "medium": "med", "large": "lg"}[edge.arrow_size]
                arrow.set("w", size)
                arrow.set("len", size)
            line._element.spPr.get_or_add_ln().append(arrow)
        parts = [line]
        layout = label_layout(
            [{"x": x, "y": y} for x, y in points],
            edge.label,
            edge.label_position,
            edge.label_offset.model_dump() if edge.label_offset else None,
            edge.label_font_size or 16,
        )
        if layout:
            labels.append(_label_shape(slide, page, edge, layout))
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
        edges_by_group.setdefault(owner, []).append(edge.id)

    # Use the same element slots and stable connection order as the DOM renderer.
    ordered = []
    for index in range(len(page.elements) + 1):
        ordered.extend(
            edge.id for edge in page.connections if min(edge.layer, len(page.elements)) == index
        )
        if index < len(page.elements):
            ordered.append(page.elements[index].id)
    ranks = {identity: index for index, identity in enumerate(ordered)}

    def group_items(group):
        identities = list(group.element_ids) + edges_by_group.get(group.id, [])
        for child in page.groups:
            if child.parent_id == group.id:
                identities.extend(group_items(child))
        return identities

    def sort_parts(parts):
        return sorted(parts, key=lambda part: part[0])

    def assemble(group):
        parts = [(ranks[i], [shapes[i]]) for i in group.element_ids]
        parts += [part for g in page.groups if g.parent_id == group.id for part in assemble(g)]
        parts += [(ranks[i], connection_shapes[i]) for i in edges_by_group.get(group.id, [])]
        parts = sort_parts(parts)
        identities = group_items(group)
        if not identities:
            return []
        low, high = min(ranks[i] for i in identities), max(ranks[i] for i in identities)
        # A PPTX group is an indivisible stacking item. Expand only groups whose
        # members interleave with outside objects, preserving the visible order.
        if high - low + 1 != len(identities):
            return parts
        result = slide.shapes.add_group_shape([shape for _, items in parts for shape in items])
        result.name = group.id
        return [(low, [result])]

    parts = [(ranks[e.id], [shapes[e.id]]) for e in page.elements if e.id not in ownership]
    parts += [(ranks[i], connection_shapes[i]) for i in edges_by_group.get(None, [])]
    for group in page.groups:
        if group.parent_id is None:
            parts.extend(assemble(group))
    for _, items in sort_parts(parts):
        for shape in items:
            slide.shapes._spTree.append(shape._element)
    # Like SlideSurface, paint all labels above paths and content, below UI handles.
    for label in labels:
        slide.shapes._spTree.append(label._element)


def _label_shape(slide, page, edge, layout):
    label = slide.shapes.add_textbox(*(px(layout[k]) for k in ("x", "y", "width", "height")))
    label.name = edge.id + "-label"
    label.fill.solid()
    label.fill.fore_color.rgb = RGBColor.from_string(page.background[1:])
    label.line.fill.background()
    frame = label.text_frame
    frame.word_wrap = False
    frame.vertical_anchor = MSO_ANCHOR.TOP
    # Lines are already wrapped by the shared layout. Centre them in the full
    # box so Office font rounding cannot wrap a smaller label a second time.
    frame.margin_left = frame.margin_right = 0
    frame.margin_top = frame.margin_bottom = px(3)
    for i, line in enumerate(layout["lines"]):
        paragraph = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        paragraph.text = line
        paragraph.alignment = PP_ALIGN.CENTER
        paragraph.space_before = paragraph.space_after = Pt(0)
        size = edge.label_font_size or 16
        paragraph.line_spacing = Pt(size * 1.25 * 0.75)
        paragraph.font.size = Pt(size * 0.75)
        paragraph.font.name = "Microsoft YaHei"
        paragraph.font.color.rgb = RGBColor.from_string(edge.color[1:])
    return label


def _connection_sites(shape, item):
    """Give custom outlines the same four explicit ports as the editor."""
    properties = getattr(shape._element, "spPr", None)
    if properties is None:
        return
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
