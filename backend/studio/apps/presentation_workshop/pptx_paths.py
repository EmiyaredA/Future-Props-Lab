from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement


def path_shape(slide, item, bounds):
    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, *bounds)
    geometry = OxmlElement("a:custGeom")
    for name in ("avLst", "gdLst", "ahLst", "cxnLst"):
        geometry.append(OxmlElement(f"a:{name}"))
    rect = OxmlElement("a:rect")
    for key, value in (("l", "0"), ("t", "0"), ("r", "r"), ("b", "b")):
        rect.set(key, value)
    geometry.append(rect)
    paths = OxmlElement("a:pathLst")
    path = OxmlElement("a:path")
    path.set("w", "100000")
    path.set("h", "100000")
    if not item.path.closed:
        path.set("fill", "none")
    points = item.path.points

    def command(name, values):
        node = OxmlElement(f"a:{name}")
        for x, y in values:
            point = OxmlElement("a:pt")
            point.set("x", str(round(x * 100000)))
            point.set("y", str(round(y * 100000)))
            node.append(point)
        path.append(node)

    command("moveTo", [(points[0].x, points[0].y)])
    if item.path.smooth and len(points) > 2:
        for i in range(1, len(points) - 1):
            a, b = points[i], points[i + 1]
            command("quadBezTo", [(a.x, a.y), ((a.x + b.x) / 2, (a.y + b.y) / 2)])
        command("lnTo", [(points[-1].x, points[-1].y)])
    else:
        for point in points[1:]:
            command("lnTo", [(point.x, point.y)])
    if item.path.closed:
        path.append(OxmlElement("a:close"))
    paths.append(path)
    geometry.append(paths)
    shape._element.spPr.replace(shape._element.spPr.find(qn("a:prstGeom")), geometry)
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(item.fill[1:])
    return shape
