"""Build the bundled FPL native 2D character from the approved local artwork.

The two paintings are the only source pixels. This script partitions them into
editable PNG layers and binds their meshes to a half-body 2D skeleton.
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "web/src/features/amadeus/art"
DEST = ROOT / "web/public/brand/amadeus"
sys.path.insert(0, str(ROOT / "backend"))

from app.capabilities.media_rendering.live2d.document import CharacterDocument  # noqa: E402
from app.capabilities.media_rendering.live2d.evaluate import (  # noqa: E402
    evaluate,
    parameter_values,
)
from app.capabilities.media_rendering.live2d.render import render_frame  # noqa: E402

WIDTH, HEIGHT = 1087, 1447
SX, SY = WIDTH / 1024, HEIGHT / 1536


def polygon(points: list[tuple[int, int]], blur: int = 0) -> Image.Image:
    mask = Image.new("L", (WIDTH, HEIGHT))
    ImageDraw.Draw(mask).polygon([(round(x * SX), round(y * SY)) for x, y in points], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(blur)) if blur else mask


def rectangle(box: tuple[int, int, int, int], blur: int = 6) -> Image.Image:
    mask = Image.new("L", (WIDTH, HEIGHT))
    ImageDraw.Draw(mask).rectangle(
        (round(box[0] * SX), round(box[1] * SY), round(box[2] * SX), round(box[3] * SY)), fill=255
    )
    return mask.filter(ImageFilter.GaussianBlur(blur)) if blur else mask


def intersection(*masks: Image.Image) -> Image.Image:
    result = masks[0]
    for mask in masks[1:]:
        result = ImageChops.multiply(result, mask)
    return result


def cut(image: Image.Image, mask: Image.Image) -> Image.Image:
    result = image.copy()
    result.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return result


def drawn(fn) -> Image.Image:
    result = Image.new("RGBA", (1024, 1536))
    fn(ImageDraw.Draw(result))
    return result.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def mesh(width: int, height: int, columns: int = 4, rows: int = 4) -> dict:
    vertices = [
        {"x": width * x / columns, "y": height * y / rows}
        for y in range(rows + 1)
        for x in range(columns + 1)
    ]
    uvs = [{"x": x / columns, "y": y / rows} for y in range(rows + 1) for x in range(columns + 1)]
    triangles = []
    for y in range(rows):
        for x in range(columns):
            a = y * (columns + 1) + x
            b = a + columns + 1
            triangles.extend((a, a + 1, b, a + 1, b + 1, b))
    return {"vertices": vertices, "uvs": uvs, "triangles": triangles}


def bone(identifier: str, name: str, parent: str | None, x: int, y: int, spring=0.0) -> dict:
    return {
        "id": f"bone-{identifier}",
        "name": name,
        "parentId": f"bone-{parent}" if parent else None,
        "x": round(x * SX),
        "y": round(y * SY),
        "rotation": 0,
        "scale": 1,
        "offsetX": 0,
        "offsetY": 0,
        "spring": spring,
        "damping": 0.55,
    }


def parameter(
    identifier: str, name: str, minimum: float, maximum: float, default: float, bindings: list[dict]
) -> dict:
    return {
        "id": identifier,
        "name": name,
        "minimum": minimum,
        "maximum": maximum,
        "default": default,
        "bindings": bindings,
    }


def scalar(target: str, field: str, values: list[tuple[float, float]]) -> dict:
    return {
        "targetId": target,
        "keys": [{"value": value, field: amount} for value, amount in values],
    }


def build() -> None:
    painted = Image.open(ART / "kurisu-neutral.png").convert("RGBA")
    blank = Image.open(ART / "kurisu-blank.png").convert("RGBA")
    if painted.size == (WIDTH, HEIGHT - 1):
        aligned = Image.new("RGBA", (WIDTH, HEIGHT))
        aligned.alpha_composite(painted)
        painted = aligned
    if painted.size != (WIDTH, HEIGHT) or blank.size != (WIDTH, HEIGHT):
        raise ValueError("Approved Amadeus artwork must remain 1087 × 1447")

    # These masks overlap at neck and shoulders: the back layer fills the space
    # exposed when head, hair, or sleeve bones rotate.
    head = polygon([(240, 0), (830, 0), (835, 640), (750, 755), (265, 760), (230, 650)], 12)
    curl = polygon(
        [(700, 500), (825, 540), (840, 810), (780, 1020), (710, 1110), (655, 1010), (665, 765)], 9
    )
    left_arm = polygon([(0, 710), (330, 710), (350, 1536), (0, 1536)], 14)
    right_arm = polygon([(735, 690), (1024, 690), (1024, 1536), (720, 1536)], 14)
    torso_mask = ImageChops.invert(head)
    torso_mask = ImageChops.multiply(torso_mask, ImageChops.invert(left_arm))
    torso_mask = ImageChops.multiply(torso_mask, ImageChops.invert(right_arm))
    torso_mask = ImageChops.multiply(torso_mask, ImageChops.invert(curl))
    face = polygon([(392, 317), (695, 317), (700, 500), (614, 617), (460, 617), (390, 510)], 5)
    fringe = polygon(
        [(320, 0), (740, 0), (720, 425), (630, 408), (540, 440), (420, 407), (315, 420)], 8
    )
    tie = polygon([(500, 627), (585, 627), (594, 1140), (480, 1140)], 4)
    upper = rectangle((0, 0, 1024, 1120), 10)
    lower = rectangle((0, 1080, 1024, 1536), 10)
    left_fringe = polygon([(305, 40), (475, 45), (495, 430), (310, 440)], 8)
    middle_fringe = polygon([(425, 20), (650, 20), (660, 445), (420, 455)], 8)
    right_fringe = polygon([(605, 30), (770, 30), (745, 440), (590, 450)], 8)
    left_lock = polygon([(260, 160), (380, 160), (410, 920), (315, 910)], 7)
    upper_curl = rectangle((630, 460, 870, 830), 9)
    lower_curl = rectangle((630, 795, 870, 1150), 9)
    shirt = polygon([(418, 580), (645, 580), (705, 1120), (560, 1260), (355, 1080)], 7)
    collar = polygon([(395, 580), (665, 580), (700, 790), (375, 790)], 6)
    left_lapel = polygon([(165, 650), (480, 630), (555, 1060), (290, 970)], 7)
    right_lapel = polygon([(615, 630), (885, 655), (790, 1010), (550, 1100)], 7)
    tie_knot = polygon([(482, 625), (595, 625), (610, 740), (475, 740)], 5)
    tie_blade = polygon([(475, 700), (610, 700), (615, 1220), (460, 1220)], 5)
    layers: list[tuple[str, str, Image.Image, str, bool]] = [
        ("torso", "躯干与白大褂", cut(blank, torso_mask), "chest", True),
        ("shirt", "衬衫前片", cut(blank, intersection(torso_mask, shirt)), "chest", True),
        (
            "left-lapel",
            "左大褂翻领",
            cut(blank, intersection(torso_mask, left_lapel)),
            "chest",
            True,
        ),
        (
            "right-lapel",
            "右大褂翻领",
            cut(blank, intersection(torso_mask, right_lapel)),
            "chest",
            True,
        ),
        (
            "left-upper-sleeve",
            "左上袖",
            cut(blank, intersection(left_arm, upper)),
            "left-upper-arm",
            True,
        ),
        (
            "left-lower-sleeve",
            "左前臂袖",
            cut(blank, intersection(left_arm, lower)),
            "left-forearm",
            True,
        ),
        (
            "right-upper-sleeve",
            "右上袖",
            cut(blank, intersection(right_arm, upper)),
            "right-upper-arm",
            True,
        ),
        (
            "right-lower-sleeve",
            "右前臂袖",
            cut(blank, intersection(right_arm, lower)),
            "right-forearm",
            True,
        ),
        ("head", "头发底层与面部底层", cut(blank, head), "head", True),
        ("face", "脸部", cut(blank, face), "head", True),
        ("collar", "衬衫衣领", cut(blank, collar), "neck", True),
        ("tie", "红领带底层", cut(blank, tie), "tie", True),
        ("tie-knot", "领带结", cut(blank, intersection(tie, tie_knot)), "tie", True),
        ("tie-blade", "领带下摆", cut(blank, intersection(tie, tie_blade)), "tie-tip", True),
        ("left-lock", "左侧发束", cut(blank, intersection(head, left_lock)), "left-hair", True),
        ("fringe", "刘海底层", cut(blank, fringe), "fringe", True),
        (
            "left-fringe",
            "左侧刘海",
            cut(blank, intersection(fringe, left_fringe)),
            "left-hair",
            True,
        ),
        (
            "middle-fringe",
            "中央刘海",
            cut(blank, intersection(fringe, middle_fringe)),
            "fringe",
            True,
        ),
        (
            "right-fringe",
            "右侧刘海",
            cut(blank, intersection(fringe, right_fringe)),
            "right-hair",
            True,
        ),
        ("front-curl", "右侧长发底层", cut(blank, curl), "right-hair", True),
        (
            "upper-curl",
            "右侧长发上段",
            cut(blank, intersection(curl, upper_curl)),
            "right-hair",
            True,
        ),
        (
            "lower-curl",
            "右侧长发末梢",
            cut(blank, intersection(curl, lower_curl)),
            "right-hair-tip",
            True,
        ),
        ("left-eye", "左眼", cut(painted, rectangle((370, 345, 515, 435))), "head", True),
        ("right-eye", "右眼", cut(painted, rectangle((530, 345, 690, 435))), "head", True),
        ("left-brow", "左眉", cut(painted, rectangle((372, 323, 521, 374))), "head", True),
        ("right-brow", "右眉", cut(painted, rectangle((529, 323, 690, 374))), "head", True),
        (
            "mouth-neutral",
            "平静口型",
            cut(painted, rectangle((485, 565, 590, 595), 4)),
            "head",
            True,
        ),
    ]

    def mouth_smile(d: ImageDraw.ImageDraw) -> None:
        d.arc((501, 565, 580, 596), 8, 170, fill="#643c38", width=4)

    def mouth_frown(d: ImageDraw.ImageDraw) -> None:
        d.arc((501, 572, 580, 603), 190, 350, fill="#643c38", width=4)

    def mouth_open(d: ImageDraw.ImageDraw) -> None:
        d.ellipse((525, 565, 558, 600), fill="#904955", outline="#643c38", width=4)

    def lids(d: ImageDraw.ImageDraw) -> None:
        d.arc((394, 354, 492, 408), 10, 173, fill="#4d3735", width=7)
        d.arc((584, 354, 682, 408), 10, 173, fill="#4d3735", width=7)

    layers.extend(
        [
            ("mouth-smile", "微笑", drawn(mouth_smile), "head", False),
            ("mouth-frown", "担忧", drawn(mouth_frown), "head", False),
            ("mouth-open", "张口", drawn(mouth_open), "head", False),
            ("closed-lids", "闭眼", drawn(lids), "head", False),
        ]
    )

    def hand(d: ImageDraw.ImageDraw) -> None:
        d.polygon(
            [
                (608, 835),
                (630, 802),
                (640, 770),
                (655, 756),
                (671, 770),
                (670, 814),
                (699, 831),
                (704, 857),
                (680, 884),
                (647, 910),
                (614, 892),
            ],
            fill="#ffe6d8",
            outline="#71524a",
            width=5,
        )

    layers.append(("thinking-hand", "思考手势", drawn(hand), "right-forearm", False))

    bones = [
        bone("root", "腰部", None, 540, 1370),
        bone("chest", "胸腔", "root", 540, 900),
        bone("neck", "颈部", "chest", 540, 646),
        bone("head", "头部", "neck", 540, 470),
        bone("left-upper-arm", "左上臂", "chest", 260, 800),
        bone("left-forearm", "左前臂", "left-upper-arm", 250, 1120),
        bone("right-upper-arm", "右上臂", "chest", 820, 800),
        bone("right-forearm", "右前臂", "right-upper-arm", 825, 1120),
        bone("fringe", "刘海发束", "head", 540, 220, 0.4),
        bone("left-hair", "左发束", "head", 320, 550, 0.5),
        bone("right-hair", "右发束", "head", 750, 680, 0.75),
        bone("right-hair-tip", "右发梢", "right-hair", 745, 970, 0.8),
        bone("tie", "领带", "chest", 540, 675, 0.45),
        bone("tie-tip", "领带末梢", "tie", 540, 1010, 0.55),
    ]
    parts: list[dict] = []
    pngs: dict[str, bytes] = {}
    for order, (identifier, name, image, bone_id, visible) in enumerate(layers):
        bounds = image.getbbox()
        if bounds is None:
            raise ValueError(f"Layer is empty: {identifier}")
        cropped = image.crop(bounds)
        output = io.BytesIO()
        cropped.save(output, "PNG", optimize=True)
        pngs[identifier] = output.getvalue()
        part_mesh = mesh(*cropped.size)
        weights = []
        for vertex in part_mesh["vertices"]:
            gy = (bounds[1] + vertex["y"]) / SY
            if identifier == "torso":
                amount = max(0.05, min(0.95, (1450 - gy) / 850))
                weights.append(
                    [
                        {"boneId": "bone-chest", "weight": amount},
                        {"boneId": "bone-root", "weight": 1 - amount},
                    ]
                )
            elif identifier.endswith("sleeve"):
                upper_id = bone_id.replace("forearm", "upper-arm")
                lower_id = bone_id.replace("upper-arm", "forearm")
                amount = max(0.05, min(0.95, (1160 - gy) / 550))
                weights.append(
                    [
                        {"boneId": f"bone-{upper_id}", "weight": amount},
                        {"boneId": f"bone-{lower_id}", "weight": 1 - amount},
                    ]
                )
            else:
                weights.append([{"boneId": f"bone-{bone_id}", "weight": 1}])
        parts.append(
            {
                "id": identifier,
                "name": name,
                "assetId": identifier,
                "group": "红莉栖",
                "parentId": None,
                "x": bounds[0],
                "y": bounds[1],
                "width": cropped.width,
                "height": cropped.height,
                **part_mesh,
                "skinWeights": weights,
                "opacity": int(visible),
                "order": order,
                "visible": True,
                "locked": False,
                "maskId": None,
            }
        )

    def opacity(identifier: str, values: list[tuple[float, float]]) -> dict:
        return scalar(identifier, "opacity", values)

    def moved(identifier: str, axis: str, amounts: list[tuple[float, float]]) -> dict:
        source = next(part for part in parts if part["id"] == identifier)["vertices"]
        return {
            "targetId": identifier,
            "keys": [
                {
                    "value": value,
                    "points": [
                        {
                            "x": point["x"] + (amount if axis == "x" else 0),
                            "y": point["y"] + (amount if axis == "y" else 0),
                        }
                        for point in source
                    ],
                }
                for value, amount in amounts
            ],
        }

    parameters = [
        parameter(
            "ParamAngleX",
            "头部侧倾",
            -30,
            30,
            0,
            [scalar("bone-head", "rotation", [(-30, -7), (0, 0), (30, 7)])],
        ),
        parameter(
            "ParamAngleY",
            "头部点头",
            -30,
            30,
            0,
            [scalar("bone-head", "offsetY", [(-30, -7), (0, 0), (30, 7)])],
        ),
        parameter(
            "ParamBodySway",
            "姿态微动",
            -1,
            1,
            0,
            [scalar("bone-chest", "rotation", [(-1, -1.2), (0, 0), (1, 1.2)])],
        ),
        parameter(
            "ParamHairSwing",
            "长发摆动",
            -1,
            1,
            0,
            [scalar("bone-right-hair", "rotation", [(-1, -3.5), (0, 0), (1, 3.5)])],
        ),
        parameter(
            "ParamBreath",
            "呼吸",
            -1,
            1,
            0,
            [scalar("bone-chest", "scale", [(-1, 0.994), (0, 1), (1, 1.006)])],
        ),
        parameter(
            "ParamEyeOpen",
            "眨眼",
            0,
            1,
            1,
            [
                opacity("left-eye", [(0, 0), (1, 1)]),
                opacity("right-eye", [(0, 0), (1, 1)]),
                opacity("closed-lids", [(0, 1), (1, 0)]),
            ],
        ),
        parameter(
            "ParamGazeX",
            "视线左右",
            -1,
            1,
            0,
            [
                moved("left-eye", "x", [(-1, -4), (0, 0), (1, 4)]),
                moved("right-eye", "x", [(-1, -4), (0, 0), (1, 4)]),
            ],
        ),
        parameter(
            "ParamGazeY",
            "视线上下",
            -1,
            1,
            0,
            [
                moved("left-eye", "y", [(-1, -3), (0, 0), (1, 3)]),
                moved("right-eye", "y", [(-1, -3), (0, 0), (1, 3)]),
            ],
        ),
        parameter(
            "ParamBrow",
            "眉眼神态",
            -1,
            1,
            0,
            [
                moved("left-brow", "y", [(-1, 6), (0, 0), (1, -6)]),
                moved("right-brow", "y", [(-1, 6), (0, 0), (1, -6)]),
            ],
        ),
        parameter(
            "ParamMouthForm",
            "嘴角",
            -1,
            1,
            0,
            [
                opacity("mouth-neutral", [(-1, 0), (0, 1), (1, 0)]),
                opacity("mouth-smile", [(-1, 0), (0, 0), (1, 1)]),
                opacity("mouth-frown", [(-1, 1), (0, 0), (1, 0)]),
            ],
        ),
        parameter("ParamMouthOpenY", "张口", 0, 1, 0, [opacity("mouth-open", [(0, 0), (1, 1)])]),
        parameter(
            "ParamHandChin", "思考手势", 0, 1, 0, [opacity("thinking-hand", [(0, 0), (1, 1)])]
        ),
    ]

    specs = {
        "idle": (
            "待命",
            90,
            {"ParamAngleX": [(0, 0), (45, 2), (90, 0)]},
            {"ParamMouthForm": 0, "ParamBrow": 0},
        ),
        "listening": (
            "聆听",
            60,
            {"ParamAngleX": [(0, 3), (30, 5), (60, 3)], "ParamAngleY": [(0, -3), (60, -3)]},
            {"ParamMouthForm": 0.1, "ParamBrow": 0.3},
        ),
        "thinking": (
            "思考",
            96,
            {"ParamAngleX": [(0, -5), (48, -8), (96, -5)], "ParamAngleY": [(0, 6), (96, 6)]},
            {"ParamMouthForm": -0.1, "ParamBrow": -0.2, "ParamHandChin": 1},
        ),
        "tool": (
            "执行",
            60,
            {"ParamAngleX": [(0, 0), (20, 3), (40, -2), (60, 0)]},
            {"ParamMouthForm": -0.1, "ParamBrow": -0.4},
        ),
        "success": (
            "完成",
            42,
            {"ParamAngleY": [(0, 0), (12, 10), (25, -4), (42, 0)]},
            {"ParamMouthForm": 1, "ParamBrow": 0.3},
        ),
        "error": (
            "关注",
            42,
            {"ParamAngleX": [(0, 0), (10, -10), (23, 5), (42, -3)]},
            {"ParamMouthForm": -1, "ParamBrow": -0.6},
        ),
        "paused": (
            "暂停",
            45,
            {"ParamAngleY": [(0, 0), (30, 6), (45, 6)]},
            {"ParamMouthForm": -0.1, "ParamBrow": -0.1, "ParamEyeOpen": 0.7},
        ),
    }
    motions = []
    expressions = []
    state_bindings = {}
    for state, (label, duration, tracks, values) in specs.items():
        motion_id = f"amadeus-{state}-motion"
        expression_id = f"amadeus-{state}-expression"
        motions.append(
            {
                "id": motion_id,
                "name": label,
                "fps": 30,
                "duration": duration,
                "loopStart": 0,
                "loopEnd": duration,
                "tracks": [
                    {
                        "parameterId": key,
                        "keys": [
                            {"frame": frame, "value": value, "interpolation": "smooth"}
                            for frame, value in keys
                        ],
                    }
                    for key, keys in tracks.items()
                ],
            }
        )
        expressions.append({"id": expression_id, "name": label, "values": values})
        state_bindings[state] = {
            "expressionId": expression_id,
            "motionId": motion_id,
            "playback": "onceHold" if state in {"success", "error", "paused"} else "loop",
        }

    data = {
        "schemaVersion": 3,
        "width": WIDTH,
        "height": HEIGHT,
        "parts": parts,
        "deformers": [],
        "bones": bones,
        "parameters": parameters,
        "motions": motions,
        "expressions": expressions,
        "stateBindings": state_bindings,
        "cameras": {
            "avatar": {
                "x": round(220 * SX),
                "y": 0,
                "width": round(650 * SX),
                "height": round(650 * SX),
            },
            "stage": {"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT},
        },
        "idleBehavior": {
            "blinkParameter": "ParamEyeOpen",
            "gazeXParameter": "ParamGazeX",
            "gazeYParameter": "ParamGazeY",
            "breathParameter": "ParamBreath",
            "swayParameter": "ParamBodySway",
            "springBones": ["bone-fringe", "bone-right-hair", "bone-tie"],
            "intensity": 0.65,
        },
        "cubismParameterIds": {},
    }
    bone_ids = {item["id"] for item in bones}
    missing = {
        (part["id"], weight["boneId"])
        for part in parts
        for vertex in part["skinWeights"]
        for weight in vertex
        if weight["boneId"] not in bone_ids
    }
    if missing:
        raise ValueError(f"Unresolved bone weights: {missing}")
    document = CharacterDocument.model_validate(data)
    DEST.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fpl-amadeus-") as temporary:
        source_paths = {}
        for key, contents in pngs.items():
            path = Path(temporary) / f"{key}.png"
            path.write_bytes(contents)
            source_paths[key] = path
        avatar = document.cameras["avatar"]
        poster = render_frame(
            document,
            source_paths,
            width=512,
            height=512,
            crop=(avatar.x, avatar.y, avatar.width, avatar.height),
        )
        poster.save(DEST / "amadeus-poster.png", "PNG", optimize=True)
        stage = render_frame(document, source_paths, width=512, height=768)
        stage.save(DEST / "amadeus-stage-poster.png", "PNG", optimize=True)
        thumb = io.BytesIO()
        poster.resize((256, 256), Image.Resampling.LANCZOS).save(thumb, "PNG")

    with zipfile.ZipFile(DEST / "amadeus.fpllive2d", "w") as archive:

        def add_file(name: str, content: bytes | str) -> None:
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)

        add_file(
            "manifest.json",
            json.dumps(
                {
                    "format": "fpllive2d",
                    "version": 3,
                    "title": "红莉栖 · Amadeus",
                    "document": document.model_dump(mode="json", by_alias=True),
                },
                ensure_ascii=False,
            ),
        )
        add_file("thumbnail.png", thumb.getvalue())
        for key, contents in pngs.items():
            add_file(f"assets/{key}.png", contents)

    fixture = {}
    for state, binding in state_bindings.items():
        motion = next(item for item in motions if item["id"] == binding["motionId"])
        frame = motion["duration"] // 2
        values = parameter_values(document, frame, binding["motionId"], binding["expressionId"])
        posed, _ = evaluate(document, values)
        fixture[state] = {
            "frame": frame,
            "values": values,
            "parts": {
                part["id"]: {
                    "opacity": part["opacity"],
                    "first": part["worldVertices"][0],
                    "last": part["worldVertices"][-1],
                }
                for part in posed
                if part["id"] in ("torso", "face", "fringe", "left-eye", "thinking-hand")
            },
        }
    (ROOT / "tests/fixtures/amadeus-evaluation.json").write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"Built {len(parts)} layers, {len(bones)} bones and {len(state_bindings)} states")


if __name__ == "__main__":
    build()
