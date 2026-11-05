from studio.apps.presentation_workshop.schemas.document import PresentationDocument


def element(kind="text", **overrides):
    return {
        "id": "text-one",
        "name": "",
        "hidden": False,
        "table": None,
        "chart": None,
        "formula": None,
        "media": None,
        "paint": None,
        "shadow": None,
        "text_layout": None,
        "image_effects": None,
        "path": None,
        "link": None,
        "kind": kind,
        "x": 80,
        "y": 100,
        "width": 650,
        "height": 240,
        "rotation": 0,
        "opacity": 1,
        "flip_x": False,
        "flip_y": False,
        "vector_color": None,
        "image_border": False,
        "locked": False,
        "fill": "#5474E5",
        "stroke": "#17334A",
        "stroke_width": 2,
        "fill_opacity": 1,
        "stroke_dash": "solid",
        "start_arrow": "none",
        "end_arrow": "none",
        "corner_radius": None,
        "asset_id": None,
        "crop": {"left": 0, "right": 0, "top": 0, "bottom": 0},
        "paragraphs": [
            {
                "align": "left",
                "line_height": 1.3,
                "bullet": False,
                "indent": 0,
                "first_line_indent": 0,
                "space_before": 0,
                "space_after": 0,
                "runs": [
                    {
                        "text": "中文标题 Native PPTX",
                        "font": "Microsoft YaHei",
                        "size": 36,
                        "color": "#17334A",
                        "bold": True,
                        "italic": False,
                        "underline": False,
                        "strike": False,
                        "highlight": None,
                        "script": "normal",
                        "code": False,
                    }
                ],
            }
        ]
        if kind == "text"
        else [],
        **overrides,
    }


def sample_document():
    return PresentationDocument.model_validate(
        {
            "version": 1,
            "width": 1280,
            "height": 720,
            "slides": [
                {
                    "id": "slide-one",
                    "background": "#FFFFFF",
                    "notes": "第一张演示者备注",
                    "elements": [element()],
                },
                {
                    "id": "slide-two",
                    "background": "#F1F5F9",
                    "notes": "旋转形状",
                    "elements": [
                        element("rect", id="shape-one", rotation=30),
                        element(id="text-two", x=300, y=320),
                    ],
                },
                {
                    "id": "slide-three",
                    "background": "#FFFFFF",
                    "notes": "谢谢",
                    "elements": [
                        element("arrow", id="shape-two", width=250, height=90),
                        element(id="text-three", y=260),
                    ],
                },
            ],
        }
    )
