"""Build a review-only, animation-free layered FPL rig from the approved art.

Outputs go to .local/output and never replace the bundled runtime character.
The visible painting is partitioned into semantic masks; generated hidden-surface
paint is placed behind it only where moving parts may expose missing pixels.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "web/src/features/amadeus/art"
OUT = ROOT / ".local/output/live2d-rig-review"
sys.path.insert(0, str(ROOT / "backend"))

from app.capabilities.media_rendering.live2d.document import CharacterDocument  # noqa: E402
from app.capabilities.media_rendering.live2d.render import render_frame  # noqa: E402

W, H = 1087, 1447


def full(image: Image.Image) -> Image.Image:
    if image.size == (W, H - 1):
        canvas = Image.new("RGBA", (W, H))
        canvas.alpha_composite(image)
        return canvas
    if image.size != (W, H):
        raise ValueError(f"Unexpected source size: {image.size}")
    return image


def polygon(points: list[tuple[int, int]]) -> bytes:
    mask = Image.new("L", (W, H))
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.tobytes()


def ellipse(box: tuple[int, int, int, int]) -> bytes:
    mask = Image.new("L", (W, H))
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    return mask.tobytes()


def layer_image(source: Image.Image, mask: bytes) -> Image.Image:
    result = source.copy()
    original = source.getchannel("A").tobytes()
    result.putalpha(
        Image.frombytes("L", (W, H), bytes(min(a, m) for a, m in zip(original, mask, strict=True)))
    )
    return result


def alpha_mesh(image: Image.Image) -> dict:
    width, height = image.size
    columns = max(2, min(24, (width + 47) // 48))
    rows = max(2, min(32, (height + 47) // 48))
    alpha = image.getchannel("A").load()
    vertices: list[dict] = []
    uvs: list[dict] = []
    triangles: list[int] = []
    indices: dict[tuple[int, int], int] = {}

    def vertex(x: int, y: int) -> int:
        key = (x, y)
        if key not in indices:
            indices[key] = len(vertices)
            vertices.append({"x": width * x / columns, "y": height * y / rows})
            uvs.append({"x": x / columns, "y": y / rows})
        return indices[key]

    for row in range(rows):
        for col in range(columns):
            x0, x1 = (
                width * col // columns,
                min(width, (width * (col + 1) + columns - 1) // columns),
            )
            y0, y1 = height * row // rows, min(height, (height * (row + 1) + rows - 1) // rows)
            painted = any(alpha[x, y] > 16 for y in range(y0, y1) for x in range(x0, x1))
            if not painted:
                continue
            a, b, c, d = (
                vertex(col, row),
                vertex(col + 1, row),
                vertex(col, row + 1),
                vertex(col + 1, row + 1),
            )
            triangles.extend((a, b, c, b, d, c))
    if not triangles:
        raise ValueError("Empty painted mesh")
    return {"vertices": vertices, "uvs": uvs, "triangles": triangles}


def bone(identifier: str, name: str, parent: str | None, x: int, y: int) -> dict:
    return {
        "id": f"bone-{identifier}",
        "name": name,
        "parentId": f"bone-{parent}" if parent else None,
        "x": x,
        "y": y,
        "rotation": 0,
        "scale": 1,
        "offsetX": 0,
        "offsetY": 0,
        "spring": 0,
        "damping": 0.5,
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


def scalar(target: str, field: str, pairs: list[tuple[float, float]]) -> dict:
    return {
        "targetId": target,
        "keys": [{"value": value, field: amount} for value, amount in pairs],
    }


def make_closed_lid(cx: int) -> Image.Image:
    image = Image.new("RGBA", (W, H))
    draw = ImageDraw.Draw(image)
    draw.arc((cx - 57, 373, cx + 57, 410), 188, 352, fill=(65, 45, 43, 255), width=5)
    return image


def joint_continuation() -> Image.Image:
    """Paint surfaces that sit entirely under the flat art at the neutral pose."""
    image = Image.new("RGBA", (W, H))
    draw = ImageDraw.Draw(image)
    draw.polygon([(410, 525), (680, 525), (700, 720), (395, 720)], fill=(237, 208, 187, 255))
    draw.polygon([(390, 635), (700, 635), (750, 840), (345, 840)], fill=(245, 245, 243, 255))
    return image


def arm_continuation(approved_alpha: Image.Image) -> Image.Image:
    image = Image.new("RGBA", (W, H))
    draw = ImageDraw.Draw(image)
    draw.polygon([(120, 990), (410, 955), (415, 1446), (115, 1446)], fill=(237, 248, 246, 255))
    draw.polygon([(675, 955), (965, 990), (970, 1446), (670, 1446)], fill=(237, 248, 246, 255))
    image.putalpha(Image.composite(image.getchannel("A"), Image.new("L", (W, H)), approved_alpha))
    return image


def build() -> None:
    original = full(Image.open(ART / "kurisu-neutral.png").convert("RGBA"))
    blank = full(Image.open(ART / "kurisu-blank.png").convert("RGBA"))
    under_hair = full(Image.open(ART / "kurisu-under-hair.png").convert("RGBA"))
    hand_sheet = Image.open(ART / "kurisu-hands.png").convert("RGBA")
    source = original.tobytes()
    erased = blank.tobytes()
    alpha = original.getchannel("A").tobytes()
    under_alpha = under_hair.getchannel("A").tobytes()
    face = polygon([(360, 245), (740, 245), (730, 575), (630, 650), (465, 650), (355, 555)])
    left_lock = polygon([(255, 145), (422, 155), (450, 855), (285, 880)])
    right_lock = polygon([(650, 170), (827, 180), (835, 1050), (690, 1110), (610, 870)])
    fringe = polygon(
        [(310, 0), (780, 0), (755, 400), (655, 430), (555, 430), (445, 430), (330, 420)]
    )
    collar = polygon([(422, 600), (668, 600), (685, 782), (405, 782)])
    shirt = polygon([(411, 626), (677, 626), (683, 1100), (563, 1175), (401, 1000)])
    left_arm = polygon([(0, 720), (350, 717), (353, 1446), (0, 1446)])
    right_arm = polygon([(760, 715), (1086, 715), (1086, 1446), (742, 1446)])
    left_eye = ellipse((391, 353, 515, 423))
    right_eye = ellipse((574, 353, 701, 423))
    left_brow = ellipse((391, 320, 518, 365))
    right_brow = ellipse((572, 320, 699, 365))
    mouth = ellipse((495, 523, 586, 564))
    ids = [
        "coat-body",
        "coat-left-upper",
        "coat-left-lower",
        "coat-right-upper",
        "coat-right-lower",
        "shirt",
        "collar",
        "tie-knot",
        "tie-blade",
        "back-hair",
        "face",
        "left-brow",
        "right-brow",
        "left-eye",
        "right-eye",
        "left-upper-lid",
        "right-upper-lid",
        "mouth",
        "fringe-left",
        "fringe-center",
        "fringe-right",
        "left-lock",
        "right-lock",
        "right-curl",
    ]
    labels = {name: index for index, name in enumerate(ids)}
    assigned = bytearray(W * H)
    for i, a in enumerate(alpha):
        if a < 2:
            continue
        x, y = i % W, i // W
        r, g, b = source[i * 4 : i * 4 + 3]
        dr, dg, db = erased[i * 4 : i * 4 + 3]
        difference = max(abs(r - dr), abs(g - dg), abs(b - db))
        hair_color = (r > g * 1.13 and g > b * 1.03 and r - b > 28) or (
            r < 105 and r > g * 1.08 and g > b * 0.9
        )
        is_hair = (y < 270 and 250 < x < 835) or (
            hair_color and y < 1100 and 240 < x < 860 and not (490 < x < 610 and y > 630)
        )
        if is_hair:
            if fringe[i] and y < 430:
                name = "fringe-left" if x < 458 else "fringe-right" if x > 640 else "fringe-center"
            elif right_lock[i] and y >= 670:
                name = "right-curl"
            elif right_lock[i] and y >= 500:
                name = "right-lock"
            elif left_lock[i] and y >= 470:
                name = "left-lock"
            else:
                name = "back-hair"
        elif face[i] and difference > 27 and left_brow[i] and y < 367:
            name = "left-brow"
        elif face[i] and difference > 27 and right_brow[i] and y < 367:
            name = "right-brow"
        elif face[i] and difference > 25 and left_eye[i]:
            name = "left-upper-lid" if y < 374 and min(r, g, b) < 200 else "left-eye"
        elif face[i] and difference > 25 and right_eye[i]:
            name = "right-upper-lid" if y < 374 and min(r, g, b) < 200 else "right-eye"
        elif face[i] and difference > 25 and mouth[i] and min(r, g, b) < 210:
            name = "mouth"
        elif face[i]:
            name = "face"
        elif 485 < x < 608 and 632 < y < 1160 and r > g * 1.45 and r > b * 1.5:
            name = "tie-knot" if y < 735 else "tie-blade"
        elif collar[i]:
            name = "collar"
        elif shirt[i]:
            name = "shirt"
        elif left_arm[i]:
            name = "coat-left-upper" if y < 1160 else "coat-left-lower"
        elif right_arm[i]:
            name = "coat-right-upper" if y < 1160 else "coat-right-lower"
        else:
            name = "coat-body"
        assigned[i] = labels[name] + 1

    OUT.mkdir(parents=True, exist_ok=True)
    layer_dir = OUT / "layers"
    layer_dir.mkdir(exist_ok=True)
    raw_dir = OUT / ".psd-work"
    raw_dir.mkdir(exist_ok=True)
    for stale in layer_dir.glob("[0-9][0-9]-*.png"):
        stale.unlink()
    for stale in raw_dir.glob("*.rgba"):
        stale.unlink()
    layer_specs: list[tuple[str, str, str, Image.Image, bool]] = []
    # Hidden continuation follows the same parent bones as the visible component.
    inside = bytes(255 if a >= 2 else 0 for a in alpha)
    hidden_face = bytes(
        255 if inside[i] and (face[i] or (310 < i % W < 780 and i // W < 430)) else 0
        for i in range(W * H)
    )
    hidden_coat = bytes(
        255 if under_alpha[i] >= 2 and 600 < i // W < 1360 and 175 < i % W < 920 else 0
        for i in range(W * H)
    )
    hair_labels = {
        labels[name] + 1
        for name in ids
        if "hair" in name or "fringe" in name or "lock" in name or "curl" in name
    }
    hidden_hair = bytes(255 if label in hair_labels else 0 for label in assigned)
    hidden_neck = bytes(
        255 if under_alpha[i] >= 2 and 410 < i % W < 700 and 550 < i // W < 790 else 0
        for i in range(W * H)
    )
    hidden_left_sleeve = bytes(
        255 if inside[i] and 195 < i % W < 360 and 740 < i // W < 1340 else 0 for i in range(W * H)
    )
    hidden_right_sleeve = bytes(
        255 if inside[i] and 730 < i % W < 895 and 740 < i // W < 1340 else 0 for i in range(W * H)
    )
    face_base = layer_image(under_hair, hidden_face)
    # Erased painting provides clean skin beneath isolated eye/brow/mouth pixels.
    face_base.paste(
        blank,
        (0, 0),
        Image.frombytes(
            "L",
            (W, H),
            bytes(
                255
                if face[i]
                and (left_eye[i] or right_eye[i] or left_brow[i] or right_brow[i] or mouth[i])
                else 0
                for i in range(W * H)
            ),
        ),
    )
    face_base.putalpha(Image.frombytes("L", (W, H), hidden_face))
    layer_specs.extend(
        [
            ("under-joints", "遮挡底画·颈肩肘连续面", "chest", joint_continuation(), True),
            (
                "under-arm-fill",
                "遮挡底画·袖口内侧",
                "chest",
                arm_continuation(original.getchannel("A")),
                True,
            ),
            (
                "under-coat",
                "遮挡底画·衣领和肩部",
                "chest",
                layer_image(under_hair, hidden_coat),
                True,
            ),
            (
                "under-left-sleeve",
                "遮挡底画·左肘",
                "left-upper",
                layer_image(original, hidden_left_sleeve),
                True,
            ),
            (
                "under-right-sleeve",
                "遮挡底画·右肘",
                "right-upper",
                layer_image(original, hidden_right_sleeve),
                True,
            ),
            ("under-neck", "遮挡底画·颈部", "neck", layer_image(under_hair, hidden_neck), True),
            ("under-face", "遮挡底画·额头和脸", "head", face_base, True),
            ("under-hair", "遮挡底画·发束根部", "head", layer_image(original, hidden_hair), True),
        ]
    )
    names = {
        "coat-body": "白大褂·躯干",
        "coat-left-upper": "左袖·上臂",
        "coat-left-lower": "左袖·前臂",
        "coat-right-upper": "右袖·上臂",
        "coat-right-lower": "右袖·前臂",
        "shirt": "衬衫前片",
        "collar": "左右衣领",
        "tie-knot": "红领带·结",
        "tie-blade": "红领带·下摆",
        "back-hair": "后发",
        "face": "脸部",
        "left-brow": "左眉",
        "right-brow": "右眉",
        "left-eye": "左眼",
        "right-eye": "右眼",
        "left-upper-lid": "左上眼睑",
        "right-upper-lid": "右上眼睑",
        "mouth": "平静口型",
        "fringe-left": "左刘海",
        "fringe-center": "中央刘海",
        "fringe-right": "右刘海",
        "left-lock": "左侧长发",
        "right-lock": "右侧长发上段",
        "right-curl": "右侧卷发末梢",
    }
    bone_for = {
        "coat-body": "chest",
        "coat-left-upper": "left-upper",
        "coat-left-lower": "left-lower",
        "coat-right-upper": "right-upper",
        "coat-right-lower": "right-lower",
        "shirt": "chest",
        "collar": "neck",
        "tie-knot": "tie",
        "tie-blade": "tie-tip",
        "back-hair": "head",
        "face": "head",
        "left-brow": "head",
        "right-brow": "head",
        "left-eye": "head",
        "right-eye": "head",
        "left-upper-lid": "head",
        "right-upper-lid": "head",
        "mouth": "head",
        "fringe-left": "fringe-left",
        "fringe-center": "fringe-center",
        "fringe-right": "fringe-right",
        "left-lock": "left-hair",
        "right-lock": "right-hair",
        "right-curl": "right-hair-tip",
    }
    for name in ids:
        mask = bytes(255 if label == labels[name] + 1 else 0 for label in assigned)
        layer_specs.append((name, names[name], bone_for[name], layer_image(original, mask), True))
    layer_specs.extend(
        [
            ("left-closed-lid", "左闭眼线", "head", make_closed_lid(452), True),
            ("right-closed-lid", "右闭眼线", "head", make_closed_lid(637), True),
        ]
    )
    # The approved painting ends at the waist; hands are spare edit-ready layers hidden at rest.
    for name, box, x in (
        ("left-hand", (0, 0, 768, 1024), 155),
        ("right-hand", (768, 0, 1536, 1024), 792),
    ):
        hand = hand_sheet.crop(box)
        clean = hand.getchannel("A").point(lambda a: 0 if a < 70 else a)
        hand.putalpha(clean)
        bound = hand.getbbox()
        if bound is None:
            raise ValueError(f"Hand asset missing: {name}")
        hand = hand.crop(bound).resize((135, 190), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (W, H))
        canvas.alpha_composite(hand, (x, 1255))
        layer_specs.append(
            (
                name,
                "左手（备用）" if name == "left-hand" else "右手（备用）",
                "left-lower" if name == "left-hand" else "right-lower",
                canvas,
                False,
            )
        )

    bones = [
        bone("root", "腰部", None, 545, 1390),
        bone("chest", "胸腔", "root", 545, 940),
        bone("neck", "颈部", "chest", 545, 620),
        bone("head", "头部", "neck", 545, 445),
        bone("left-upper", "左上臂", "chest", 265, 760),
        bone("left-lower", "左前臂", "left-upper", 240, 1130),
        bone("right-upper", "右上臂", "chest", 820, 760),
        bone("right-lower", "右前臂", "right-upper", 845, 1130),
        bone("fringe-left", "左刘海", "head", 420, 185),
        bone("fringe-center", "中央刘海", "head", 545, 190),
        bone("fringe-right", "右刘海", "head", 675, 185),
        bone("left-hair", "左发束", "head", 360, 490),
        bone("right-hair", "右发束", "head", 735, 580),
        bone("right-hair-tip", "右发梢", "right-hair", 730, 885),
        bone("tie", "领带", "chest", 545, 685),
        bone("tie-tip", "领带末梢", "tie", 545, 980),
    ]
    parts: list[dict] = []
    pngs: dict[str, bytes] = {}
    manifest_layers: list[dict] = []
    for order, (identifier, display, bound_bone, canvas, visible) in enumerate(layer_specs):
        bounds = canvas.getbbox()
        if bounds is None:
            raise ValueError(f"Empty layer: {identifier}")
        image = canvas.crop(bounds)
        mesh = alpha_mesh(image)
        weights = []
        for vertex in mesh["vertices"]:
            y = bounds[1] + vertex["y"]
            if identifier in {"coat-body", "under-coat"}:
                chest = max(0.1, min(0.9, (H - y) / 640))
                weights.append(
                    [
                        {"boneId": "bone-chest", "weight": chest},
                        {"boneId": "bone-root", "weight": 1 - chest},
                    ]
                )
            elif identifier in {
                "coat-left-upper",
                "coat-left-lower",
                "coat-right-upper",
                "coat-right-lower",
            }:
                side = "left" if "left" in identifier else "right"
                upper = max(0.08, min(0.92, (1300 - y) / 600))
                weights.append(
                    [
                        {"boneId": f"bone-{side}-upper", "weight": upper},
                        {"boneId": f"bone-{side}-lower", "weight": 1 - upper},
                    ]
                )
            elif identifier == "right-curl":
                parent = max(0.2, min(0.98, (1120 - y) / 470))
                weights.append(
                    [
                        {"boneId": "bone-right-hair", "weight": parent},
                        {"boneId": "bone-right-hair-tip", "weight": 1 - parent},
                    ]
                )
            else:
                weights.append([{"boneId": f"bone-{bound_bone}", "weight": 1}])
        opacity = 0 if identifier in {"left-closed-lid", "right-closed-lid"} else 1
        parts.append(
            {
                "id": identifier,
                "assetId": identifier,
                "name": display,
                "group": "红莉栖/隐藏底画" if identifier.startswith("under-") else "红莉栖/部件",
                "parentId": None,
                "x": bounds[0],
                "y": bounds[1],
                "width": image.width,
                "height": image.height,
                **mesh,
                "skinWeights": weights,
                "opacity": opacity,
                "order": order,
                "visible": visible,
                "locked": False,
                "maskId": None,
            }
        )
        png = io.BytesIO()
        image.save(png, "PNG", optimize=True)
        pngs[identifier] = png.getvalue()
        (layer_dir / f"{order + 1:02d}-{identifier}.png").write_bytes(png.getvalue())
        (raw_dir / f"{identifier}.rgba").write_bytes(image.tobytes())
        manifest_layers.append(
            {
                "id": identifier,
                "name": display,
                "x": bounds[0],
                "y": bounds[1],
                "width": image.width,
                "height": image.height,
                "visible": visible,
                "bone": f"bone-{bound_bone}",
            }
        )

    parameters = [
        parameter(
            "ParamAngleX",
            "头部侧倾",
            -30,
            30,
            0,
            [scalar("bone-neck", "rotation", [(-30, -6), (0, 0), (30, 6)])],
        ),
        parameter(
            "ParamBodySway",
            "身体倾斜",
            -1,
            1,
            0,
            [scalar("bone-chest", "rotation", [(-1, -2), (0, 0), (1, 2)])],
        ),
        parameter(
            "ParamLeftArm",
            "左臂弯曲",
            -1,
            1,
            0,
            [scalar("bone-left-lower", "rotation", [(-1, -8), (0, 0), (1, 8)])],
        ),
        parameter(
            "ParamRightArm",
            "右臂弯曲",
            -1,
            1,
            0,
            [scalar("bone-right-lower", "rotation", [(-1, 8), (0, 0), (1, -8)])],
        ),
        parameter(
            "ParamHairSwing",
            "右发束摆动",
            -1,
            1,
            0,
            [
                scalar("bone-right-hair", "rotation", [(-1, -4), (0, 0), (1, 4)]),
                scalar("bone-right-hair-tip", "rotation", [(-1, -1), (0, 0), (1, 1)]),
            ],
        ),
        parameter(
            "ParamEyeOpen",
            "睁闭眼",
            0,
            1,
            1,
            [
                *[
                    scalar(name, "opacity", [(0, 0), (1, 1)])
                    for name in ("left-eye", "right-eye", "left-upper-lid", "right-upper-lid")
                ],
                *[
                    scalar(name, "opacity", [(0, 1), (1, 0)])
                    for name in ("left-closed-lid", "right-closed-lid")
                ],
            ],
        ),
        parameter(
            "ParamMouthOpenY", "口型", 0, 1, 0, [scalar("mouth", "opacity", [(0, 1), (1, 0.2)])]
        ),
    ]
    data = {
        "schemaVersion": 3,
        "width": W,
        "height": H,
        "parts": parts,
        "deformers": [],
        "bones": bones,
        "parameters": parameters,
        "motions": [],
        "expressions": [],
        "stateBindings": {},
        "cameras": {
            "avatar": {"x": 255, "y": 15, "width": 580, "height": 580},
            "stage": {"x": 0, "y": 0, "width": W, "height": 1370},
        },
        "idleBehavior": {"springBones": [], "intensity": 0},
        "cubismParameterIds": {},
    }
    doc = CharacterDocument.model_validate(data)
    (OUT / "layer-manifest.json").write_text(
        json.dumps(
            {"width": W, "height": H, "layers": manifest_layers}, ensure_ascii=False, indent=2
        )
    )
    subprocess.run(["node", "scripts/write_live2d_review_psd.mjs", str(OUT)], cwd=ROOT, check=True)
    for file in raw_dir.iterdir():
        file.unlink()
    raw_dir.rmdir()
    source_paths = {
        key: layer_dir / f"{index + 1:02d}-{key}.png"
        for index, (key, *_rest) in enumerate(layer_specs)
    }
    with zipfile.ZipFile(
        OUT / "kurisu-rig-draft.fpllive2d", "w", compression=zipfile.ZIP_DEFLATED
    ) as package:
        package.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "fpllive2d",
                    "version": 3,
                    "title": "红莉栖·分层骨骼验收草案",
                    "document": doc.model_dump(mode="json", by_alias=True),
                },
                ensure_ascii=False,
            ),
        )
        for identifier, png in pngs.items():
            package.writestr(f"assets/{identifier}.png", png)
    cameras = doc.cameras
    checks = {
        "neutral": {},
        "eye-closed": {"ParamEyeOpen": 0},
        "head-left": {"ParamAngleX": -30},
        "body-and-arms": {
            "ParamBodySway": 1,
            "ParamLeftArm": 1,
            "ParamRightArm": -1,
            "ParamHairSwing": 1,
        },
    }
    contact = Image.new("RGBA", (4 * 400, 680), "#1a2230")
    draw = ImageDraw.Draw(contact)
    for column, (name, overrides) in enumerate(checks.items()):
        pose_data = doc.model_dump(mode="json", by_alias=True)
        if overrides:
            pose_data["expressions"] = [
                {"id": "review-pose", "name": "静态验收姿态", "values": overrides}
            ]
        pose_doc = CharacterDocument.model_validate(pose_data)
        preview = "review-pose" if overrides else None
        stage_camera = cameras["stage"]
        stage = render_frame(
            pose_doc,
            source_paths,
            width=360,
            height=480,
            crop=(stage_camera.x, stage_camera.y, stage_camera.width, stage_camera.height),
            expression_id=preview,
        )
        avatar = cameras["avatar"]
        crop = (avatar.x, avatar.y, avatar.width, avatar.height)
        small = render_frame(
            pose_doc, source_paths, width=48, height=48, crop=crop, expression_id=preview
        )
        large = render_frame(
            pose_doc, source_paths, width=76, height=76, crop=crop, expression_id=preview
        )
        stage.save(OUT / f"{name}-stage.png")
        small.save(OUT / f"{name}-48.png")
        large.save(OUT / f"{name}-76.png")
        x = column * 400 + 20
        contact.alpha_composite(stage, (x, 32))
        contact.alpha_composite(small.resize((96, 96)), (x, 515))
        contact.alpha_composite(large.resize((152, 152)), (x + 115, 515))
        draw.text((x, 5), name, fill="#fff")
    contact.save(OUT / "pose-contact-sheet.png")
    # Pixel-level neutral reconstruction audit; alpha partition must cover the approved artwork.
    rebuilt = Image.new("RGBA", (W, H))
    for identifier, _name, _bone, image, visible in layer_specs:
        if (
            visible
            and not identifier.startswith("under-")
            and identifier not in {"left-closed-lid", "right-closed-lid"}
        ):
            rebuilt.alpha_composite(image)
    rebuilt.save(OUT / "neutral-layer-reconstruction.png")
    (OUT / "README.md").write_text(
        "# 红莉栖分层与骨骼验收草案\n\n"
        "此草案不含动作、表情或七状态绑定；不会替换当前内置案例和 Amadeus 运行头像。\n"
        "`layers/` 是逐层透明 PNG；`kurisu-rig-draft.psd` 是同一图层的 RGB 分层工程；"
        "`.fpllive2d` 可用工坊现有导入工程功能创建可编辑副本。\n"
        "`pose-contact-sheet.png` 和各尺寸 PNG 是静态关键姿态审阅图。"
        "隐藏底画源自原画的局部补绘，手部为备用隐藏图层。"
        "目前头部侧倾时领口和发束接缝仍可见，应作为绑定验收阻断项继续修整；"
        "正式动画需在验收后制作。\n",
        encoding="utf-8",
    )
    print(f"{len(parts)} layers, {len(bones)} bones, {len(parameters)} parameters -> {OUT}")


if __name__ == "__main__":
    build()
