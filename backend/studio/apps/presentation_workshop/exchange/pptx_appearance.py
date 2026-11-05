"""Map self-contained fills and text marks, reporting unsupported source styling."""

from uuid import uuid4

from pptx.oxml.ns import qn

from studio.apps.presentation_workshop.exchange.contracts import ImportedFile


def paint(properties, part, assets, issue):
    if properties is None:
        return None
    gradient = properties.find(qn("a:gradFill"))
    if gradient is not None:
        stops = gradient.xpath("./a:gsLst/a:gs/a:srgbClr")
        if len(stops) < 2:
            issue("theme_fill", "主题渐变颜色需要人工核对，使用基础颜色")
            return None
        if len(stops) > 2:
            issue("gradient_stops", "多色渐变按首尾颜色转换")
        linear = gradient.find(qn("a:lin"))
        return {
            "type": "linear" if linear is not None else "radial",
            "color": "#" + stops[0].get("val"),
            "end_color": "#" + stops[-1].get("val"),
            "angle": (90 - int(linear.get("ang", 0)) / 60000) % 360 if linear is not None else 90,
        }
    blip = properties.find(".//" + qn("a:blip"))
    if blip is not None:
        identity = blip.get(qn("r:embed"))
        if not identity:
            issue("external_fill", "外部图片填充未导入，请使用本地文件重新设置")
            return None
        source = part.related_part(identity)
        identity = uuid4().hex
        assets[identity] = ImportedFile(identity + ".png", source.content_type, source.blob)
        if properties.xpath("./a:blipFill/a:tile"):
            issue("image_tile", "平铺图片填充使用工坊的固定平铺尺寸")
        return {"type": "image", "asset_id": identity, "fit": "cover"}
    if properties.xpath("./a:pattFill|./a:grpFill"):
        issue("unsupported_fill", "纹理或继承填充未转换，请检查对象外观")
    return None


def text_marks(run):
    props = run._r.rPr
    if props is None:
        return {}
    baseline = int(props.get("baseline", 0))
    highlight = props.find("./" + qn("a:highlight") + "/" + qn("a:srgbClr"))
    return {
        "strike": props.get("strike") in {"sngStrike", "dblStrike"},
        "script": "sup" if baseline > 0 else "sub" if baseline < 0 else "normal",
        "highlight": "#" + highlight.get("val") if highlight is not None else None,
    }


def text_layout(frame):
    from pptx.enum.text import MSO_ANCHOR

    return {
        "vertical": frame._txBody.bodyPr.get("vert") in {"vert", "eaVert", "vert270"},
        "align": {MSO_ANCHOR.MIDDLE: "middle", MSO_ANCHOR.BOTTOM: "bottom"}.get(
            frame.vertical_anchor, "top"
        ),
        "padding": min(100, max(0, float(frame.margin_left or 0) / 9525)),
        "auto_fit": False,
        "letter_spacing": 0,
    }


def report_appearance(shape, issue):
    if shape._element.xpath(".//a:schemeClr"):
        issue("theme_colors", f"{shape.name} 包含主题颜色，请检查转换后的配色")
    if shape._element.xpath(".//a:effectLst/*|.//a:effectDag|.//a:scene3d|.//a:sp3d"):
        issue("visual_effects", f"{shape.name} 的阴影、三维或图片特效未导入")
    if shape.has_text_frame:
        fonts = {run.font.name for p in shape.text_frame.paragraphs for run in p.runs}
        if fonts - {"Arial", "Consolas", "Microsoft YaHei"}:
            issue("font_substitution", f"{shape.name} 的其他或继承字体使用本地微软雅黑，请核对换行")
    if shape.has_chart:
        issue("chart_style", f"{shape.name} 保留可编辑数据，标题、坐标轴与图例按工坊主题转换")
    if shape.has_table:
        issue(
            "table_style",
            f"{shape.name} 保留表格和合并关系，行高、边框及混合文字样式按工坊样式转换",
        )
