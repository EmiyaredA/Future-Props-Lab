"""Joint package validation keeps legacy packages and data-only imports compatible."""

from __future__ import annotations

import copy
import io
import json
import zipfile

import pytest

from app.apps.desktop_pet.whale_package import read_whale_package
from test_desktop_pet import whale_archive
from test_desktop_pet_human import archive, human_model


def articulated_model():
    model = human_model()
    rig = {
        "version": 1,
        "waist": [128, 188],
        "hiddenParts": ["arm_near", "arm_far", "leg_back", "leg_front"],
        "limbs": {},
    }
    for name in ("armNear", "armFar", "legBack", "legFront"):
        ids = []
        for parent in (name, f"{name}Lower", f"{name}End"):
            part = copy.deepcopy(model["parts"][0])
            part.update(id=f"motion_{parent}", parent=parent, uvBox=[0, 0.2, 1, 0.8])
            model["parts"].append(part)
            ids.append(part["id"])
        rig["limbs"][name] = {
            "root": [100, 150],
            "joint": [105, 175],
            "end": [110, 195],
            "parts": ids,
        }
    head = copy.deepcopy(model["parts"][0])
    head.update(id="profile_head", parent="head")
    model["parts"].append(head)
    rig["profileHead"] = {
        "part": "profile_head",
        "hiddenParts": ["hair_back", "hair_front", "face"],
        "eye": [143, 89, 16, 22],
        "brow": [143, 86, 16, 3],
        "mouth": [160, 115, 4, 3],
    }
    model["motionRig"] = rig
    return model


def test_joint_package_and_legacy_package_round_trip():
    for model in (human_model(), articulated_model()):
        assert read_whale_package(archive(model)).model == model


def authored_model():
    model = articulated_model()
    rig = model["motionRig"]
    rig["version"] = 2
    rig["poses"] = {}
    for name in ("walk", "held", "side", "top", "bottom", "glide"):
        part = copy.deepcopy(model["parts"][0])
        part.update(id=f"pose_{name}", parent="body")
        model["parts"].append(part)
        rig["poses"][name] = {
            "part": part["id"],
            "waist": [128, 188],
            "edges": {edge: [128, 188] for edge in ("left", "right", "top", "bottom")},
            "face": {
                "eye": [100, 100, 16, 20],
                "brow": [100, 98, 16, 2],
                "mouth": [108, 122, 4, 2],
                "twoEyes": False,
                "angle": 0,
            },
            "limbs": {
                key: {
                    "root": [100, 150],
                    "joint": [105, 175],
                    "end": [110, 195],
                    "region": [[90, 140], [120, 140], [120, 210], [90, 210]],
                    "limits": [-35, 35, -55, 55],
                    "bend": 1,
                }
                for key in ("armNear", "armFar", "legBack", "legFront")
            },
        }
    return model


def test_authored_pose_package_keeps_existing_sprites_and_schemes():
    model = authored_model()
    result = read_whale_package(archive(model))
    assert result.model == model
    assert result.model["motionRig"]["version"] == 2


def test_whole_pose_face_source_rectangle_checks_actual_registered_image():
    model = authored_model()
    face = model["motionRig"]["poses"]["walk"]["face"]
    face["sourceRects"] = {"eyes": [0, 0, 1, 1]}
    assert read_whale_package(archive(model)).model == model
    face["sourceRects"]["eyes"] = [0, 0, 17, 1]
    with pytest.raises(ValueError, match="源裁切超出"):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "rect",
    [
        [],
        [0, 0, 0, 1],
        [-1, 0, 1, 1],
        [True, 0, 1, 1],
        [0, 0, 4097, 1],
        [4096, 0, 1, 1],
        [0, 0, float("inf"), 1],
    ],
)
def test_whole_pose_face_source_rectangle_rejects_invalid_geometry(rect):
    model = authored_model()
    model["motionRig"]["poses"]["walk"]["face"]["sourceRects"] = {"eyes": rect}
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


def segmented_model():
    model = authored_model()
    for pose_name, pose in model["motionRig"]["poses"].items():
        for limb_name, limb in pose["limbs"].items():
            limb["segments"] = []
            for index in range(3):
                part = copy.deepcopy(model["parts"][0])
                part.update(id=f"{pose_name}_{limb_name}_{index}", parent="body")
                model["parts"].append(part)
                limb["segments"].append(part["id"])
    return model


def test_authored_rigid_segments_preserve_legacy_and_complete_pose_imports():
    model = segmented_model()
    assert read_whale_package(archive(model)).model == model


def test_authored_head_preserves_neck_landmark_and_validates_asset_reference():
    model = authored_model()
    part = copy.deepcopy(model["parts"][0])
    part.update(id="walk_head", parent="body")
    model["parts"].append(part)
    pose = model["motionRig"]["poses"]["walk"]
    pose["head"] = {"part": "walk_head", "neck": [133, 128]}
    assert read_whale_package(archive(model)).model == model
    for head in (
        {"part": "unknown", "neck": [133, 128]},
        {"part": pose["part"], "neck": [133, 128]},
        {"part": "walk_head", "neck": [133, float("nan")]},
        {"part": "walk_head", "neck": [133, 128], "script": "no"},
    ):
        pose["head"] = head
        with pytest.raises(ValueError):
            read_whale_package(archive(model))


def test_authored_segment_capacity_remains_bounded():
    model = segmented_model()
    while len(model["parts"]) <= 128:
        part = copy.deepcopy(model["parts"][0])
        part.update(id=f"extra_{len(model['parts'])}", parent="body")
        model["parts"].append(part)
    with pytest.raises(ValueError, match="模型结构无效"):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "fault",
    ["missing", "duplicate", "wrong_parent", "whole_part", "shared", "not_three", "not_string"],
)
def test_authored_rigid_segments_reject_ambiguous_or_invalid_references(fault):
    model = segmented_model()
    poses = model["motionRig"]["poses"]
    limb = poses["walk"]["limbs"]["legFront"]
    ids = limb["segments"]
    if fault == "missing":
        ids[0] = "does-not-exist"
    elif fault == "duplicate":
        ids[1] = ids[0]
    elif fault == "wrong_parent":
        next(p for p in model["parts"] if p["id"] == ids[0])["parent"] = "head"
    elif fault == "whole_part":
        limb["part"] = poses["walk"]["part"]
    elif fault == "shared":
        poses["held"]["limbs"]["legFront"]["segments"] = ids.copy()
    elif fault == "not_three":
        ids.pop()
    else:
        ids[0] = 7
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


def test_authored_pose_can_reference_registered_clean_features_without_replacing_standing_face():
    model = authored_model()
    model["feat"]["sprites"]["profile_eye"] = [100, 100, 116, 120]
    model["motionRig"]["poses"]["side"]["face"]["sprites"] = {"eyes": "profile_eye"}
    assert read_whale_package(archive(model)).model == model


@pytest.mark.parametrize(
    "binding", [{}, {"eyes": "missing"}, {"eyes": 3}, {"new_expression": "eyes"}, ["eyes"]]
)
def test_authored_pose_rejects_unregistered_or_unrecognized_feature_bindings(binding):
    model = authored_model()
    model["motionRig"]["poses"]["side"]["face"]["sprites"] = binding
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "clip",
    [
        [[True, 20], [30, 40], [50, 60]],
        [[10, 20], [30, 40]],
        [[float("nan"), 20], [30, 40], [50, 60]],
        [[513, 20], [30, 40], [50, 60]],
    ],
)
def test_authored_face_occlusion_polygon_is_bounded_and_finite(clip):
    model = authored_model()
    model["motionRig"]["poses"]["side"]["face"]["clip"] = clip
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p.pop("top"),
        lambda p: p["held"].update(part="missing"),
        lambda p: p["held"].update(part=p["walk"]["part"]),
        lambda p: p["held"].update(waist=[float("nan"), 188]),
        lambda p: p["held"]["edges"].pop("bottom"),
        lambda p: p["held"]["edges"].update(top=[True, 100]),
        lambda p: p["held"]["limbs"].pop("armNear"),
        lambda p: p["held"]["limbs"]["armNear"].update(joint=[100, 150]),
        lambda p: p["held"]["limbs"]["armNear"].update(limits=[0, 200, -50, 50]),
        lambda p: p["held"]["limbs"]["armNear"].update(limits=[-35, 35, 20, 40]),
        lambda p: p["held"]["limbs"]["armNear"].update(bend=True),
        lambda p: p["held"]["limbs"]["armNear"].update(region=[[1, 2]]),
        lambda p: p["held"]["face"].update(angle=float("inf")),
        lambda p: p["held"]["face"].update(twoEyes="yes"),
        lambda p: p["held"]["face"].update(eye=[100, 100, -1, 10]),
    ],
)
def test_authored_pose_bindings_reject_invalid_references_and_numeric_values(mutation):
    model = authored_model()
    mutation(model["motionRig"]["poses"])
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize("contact", [[True, 20], [float("inf"), 20], [400, 400], [10]])
def test_authored_support_points_are_finite_and_local_to_the_joint(contact):
    model = authored_model()
    model["motionRig"]["poses"]["walk"]["limbs"]["legFront"]["contact"] = contact
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda m: m["motionRig"].update(version=True),
        lambda m: m["motionRig"].update(version=2),
        lambda m: m["motionRig"].update(waist=[True, 188]),
        lambda m: m["motionRig"].update(waist=[513, 188]),
        lambda m: m["motionRig"]["limbs"].pop("armNear"),
        lambda m: m["motionRig"]["limbs"]["armNear"].update(root=[float("inf"), 150]),
        lambda m: m["motionRig"]["limbs"]["armNear"].update(joint=[100, 150]),
        lambda m: m["motionRig"]["limbs"]["armNear"].update(
            parts=["missing", "arm_near", "arm_far"]
        ),
        lambda m: m["motionRig"]["limbs"]["armNear"].update(jointPart="face"),
        lambda m: m["motionRig"].update(hiddenParts=["face", "face"]),
        lambda m: m["parts"][-1].update(parent="armNearLower"),
        lambda m: m["parts"][-1].update(uvBox=[0, 0, 2, 1]),
        lambda m: m["parts"][-1].update(uvBox=[0, 0.8, 1, 0.2]),
        lambda m: m["parts"][-1].update(uvBox=[False, 0, 1, 1]),
        lambda m: m["motionRig"]["profileHead"].update(part="missing"),
        lambda m: m["motionRig"]["profileHead"].update(eye=[0, 0, -1, 10]),
        lambda m: m["motionRig"]["profileHead"].update(hiddenParts=["profile_head"]),
        lambda m: m["motionRig"].update(neck=[False, 128]),
    ],
)
def test_invalid_joint_or_uv_description_is_rejected(mutation):
    model = articulated_model()
    mutation(model)
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


def whale_authored_model():
    with zipfile.ZipFile(io.BytesIO(whale_archive())) as package:
        model = json.loads(package.read("model.json"))
    for part in model["parts"]:
        part.update(parent="body", z=1)
    for eye in model["feat"]["eyes"].values():
        eye.update(
            lash=[600, 600, 640, 620],
            ball=[600, 600, 640, 650],
            iris=[610, 610, 630, 640],
            lidFit=[0, 0, 600],
            rimFit=[0, 0, 650],
        )
    rig = model["motionRig"] = {
        "version": 2,
        "waist": [128, 188],
        "neck": [128, 120],
        "hiddenParts": [part["id"] for part in model["parts"]],
        "supportedEdges": ["left", "right", "top", "bottom"],
        "poses": {},
    }
    for name, source in authored_model()["motionRig"]["poses"].items():
        pose = copy.deepcopy(source)
        pose.pop("face")
        pose["neck"] = [128, 120]
        pose["layers"] = {"headBack": []}
        pose["face"] = {
            "kind": "whale",
            "transform": [0.2, 0, 0, 0.2, 100, 100],
            "clip": [[100, 100], [200, 100], [200, 180], [100, 180]],
        }
        ids = [pose["part"]]
        for limb_name, limb in pose["limbs"].items():
            limb["segments"] = [f"{name}_{limb_name}_{i}" for i in range(3)]
            ids.extend(limb["segments"])
        for slot in ("headFront", "skirt", "tail", "finNear", "finFar"):
            pose["layers"][slot] = [f"{name}_{slot}"]
            ids.extend(pose["layers"][slot])
        for part_id in ids:
            model["parts"].append(
                {
                    "id": part_id,
                    "tex": "body",
                    "parent": "body",
                    "z": 1,
                    "box": [0, 0, 64, 64],
                    "grid": [2, 2],
                }
            )
        rig["poses"][name] = pose
    return model


def whale_motion_archive(model):
    """An actual ZIP with the registered whale eye layers, not a mocked validator."""
    with zipfile.ZipFile(io.BytesIO(archive(model))) as source:
        entries = {name: source.read(name) for name in source.namelist()}
    png = next(content for name, content in entries.items() if name.startswith("tex/"))
    for index, scheme in enumerate(model["schemes"]):
        prefix = "" if index == 0 else f"schemes/{scheme['id']}/"
        for eye_name, eye in model["feat"]["eyes"].items():
            for layer in ("lash", "ball", "iris", *(["rim"] if eye.get("rim") else [])):
                entries[f"{prefix}feat/{eye_name}_{layer}.png"] = png
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name, content in entries.items():
            package.writestr(name, content)
    return output.getvalue()


def test_whale_v2_keeps_native_eye_layers_schemes_and_explicit_four_edges():
    model = whale_authored_model()
    model["feat"]["eyes"]["eyeL"]["rim"] = [600, 600, 640, 650]
    result = read_whale_package(whale_motion_archive(model))
    assert result.model == model
    assert "eyes" not in result.model["feat"]["sprites"]
    assert result.images["feat/eyeL_ball.png"]
    assert result.images["schemes/harness/feat/eyeL_rim.png"]
    assert set(result.model["motionRig"]["supportedEdges"]) == {"left", "right", "top", "bottom"}
    assert {part["tex"] for part in model["parts"]} == {
        "body",
        "skirt",
        "skirt_sit",
        "tail",
        "hair_back",
        "bangs",
        "brows",
        "eye_creases",
    }


def test_old_whale_without_rig_is_unchanged_and_never_gains_four_edge_metadata():
    result = read_whale_package(whale_archive())
    assert "motionRig" not in result.model
    assert "supportedEdges" not in result.model


@pytest.mark.parametrize("profile", ["legacy-whale", "whale-v2", "human-v1"])
def test_motion_part_capacity_requires_full_profile_specific_validation(profile):
    if profile == "whale-v2":
        model = whale_authored_model()
        writer = whale_motion_archive
        cap = 128
    elif profile == "legacy-whale":
        with zipfile.ZipFile(io.BytesIO(whale_archive())) as package:
            model = json.loads(package.read("model.json"))
        writer = whale_motion_archive
        cap = 80
    else:
        model = articulated_model()
        writer = archive
        cap = 80
    while len(model["parts"]) < cap:
        part = copy.deepcopy(model["parts"][0])
        part.update(id=f"extra_{len(model['parts'])}")
        model["parts"].append(part)
    assert read_whale_package(writer(model)).model == model
    extra = copy.deepcopy(model["parts"][0])
    extra.update(id="one_too_many")
    model["parts"].append(extra)
    with pytest.raises(ValueError, match="模型结构无效"):
        read_whale_package(writer(model))
    if profile == "whale-v2":
        model["parts"].pop()
        model["motionRig"].pop("poses")
        with pytest.raises(ValueError, match="完整版本二"):
            read_whale_package(writer(model))


@pytest.mark.parametrize(
    "mutation",
    [
        lambda m: m["motionRig"].update(version=True),
        lambda m: m["motionRig"].update(version=1),
        lambda m: m["motionRig"].update(script="bad"),
        lambda m: m["motionRig"].update(waist=[float("inf"), 188]),
        lambda m: m["motionRig"].update(neck=[True, 120]),
        lambda m: m["motionRig"].update(supportedEdges=["left", "right"]),
        lambda m: m["motionRig"].update(supportedEdges=["left", "right", "top", "top"]),
        lambda m: m["motionRig"]["poses"].pop("top"),
        lambda m: m["motionRig"]["poses"].update(script={}),
        lambda m: m["motionRig"].update(hiddenParts=["missing"]),
        lambda m: m["motionRig"].update(hiddenParts=[m["motionRig"]["poses"]["walk"]["part"]]),
        lambda m: m["motionRig"]["poses"]["held"].update(head={"part": "body", "neck": [1, 2]}),
        lambda m: m["motionRig"]["poses"]["held"].update(neck=[513, 120]),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].pop("tail"),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(headFront=[]),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(head="body"),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(skirt=["missing"]),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(
            skirt=m["motionRig"]["poses"]["walk"]["layers"]["skirt"]
        ),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(
            skirt=["held_skirt", "held_skirt"]
        ),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(
            skirt=[m["motionRig"]["poses"]["walk"]["part"]]
        ),
        lambda m: m["motionRig"]["poses"]["held"]["layers"].update(
            skirt=m["motionRig"]["poses"]["held"]["limbs"]["armNear"]["segments"]
        ),
        lambda m: m["motionRig"]["poses"]["held"]["limbs"]["armNear"].pop("segments"),
        lambda m: m["parts"][-1].update(parent="unknown"),
        lambda m: m["parts"][-1].update(parent="neck"),
        lambda m: m["parts"][-1].update(script="bad"),
        lambda m: m["parts"][-1].update(tex="../escape"),
        lambda m: m["parts"][-1].update(id=m["parts"][0]["id"]),
        lambda m: m["parts"][-1].update(alpha=float("inf")),
        lambda m: m["parts"][-1].update(tex="faceFx"),
        lambda m: m["view"].__setitem__(2, 513),
        lambda m: m["feat"]["eyes"]["eyeL"].update(lidFit=[float("nan"), 0, 600]),
        lambda m: m["feat"]["eyes"]["eyeR"].update(ball=[600, 600, 600, 650]),
        lambda m: m["feat"]["eyes"]["eyeL"].update(script="bad"),
    ],
)
def test_whale_v2_rejects_incomplete_unsafe_or_incompatible_layer_geometry(mutation):
    model = whale_authored_model()
    mutation(model)
    with pytest.raises(ValueError):
        read_whale_package(whale_motion_archive(model))


@pytest.mark.parametrize(
    "transform",
    [
        [0, 0, 0, 0, 0, 0],
        [-0.2, 0, 0, 0.2, 100, 100],
        [True, 0, 0, 0.2, 100, 100],
        [float("inf"), 0, 0, 0.2, 100, 100],
        [5, 0, 0, 0.2, 100, 100],
        [0.2, 0, 0, 0.2, 513, 100],
        [1, 0, 0],
    ],
)
def test_whale_face_affine_is_bounded_non_degenerate_and_not_reflected(transform):
    model = whale_authored_model()
    model["motionRig"]["poses"]["held"]["face"]["transform"] = transform
    with pytest.raises(ValueError, match="投影|非法数字"):
        read_whale_package(whale_motion_archive(model))


@pytest.mark.parametrize(
    "face",
    [
        {"kind": "human", "transform": [1, 0, 0, 1, 0, 0], "clip": [[0, 0], [1, 0], [0, 1]]},
        {"kind": "whale", "transform": [1, 0, 0, 1, 0, 0], "clip": [[0, 0], [1, 1], [2, 2]]},
        {"kind": "whale", "transform": [1, 0, 0, 1, 0, 0], "clip": [[0, 0], [True, 1], [1, 0]]},
        {"eye": [0, 0, 10, 10], "twoEyes": True, "sprites": {"eyes": "eyes"}},
    ],
)
def test_whale_native_face_contract_rejects_human_protocol_and_invalid_clip(face):
    model = whale_authored_model()
    model["motionRig"]["poses"]["held"]["face"] = face
    with pytest.raises(ValueError, match="五官"):
        read_whale_package(whale_motion_archive(model))


def test_whale_face_rotation_preserves_canonical_sources_but_missing_eye_file_is_rejected():
    model = whale_authored_model()
    model["motionRig"]["poses"]["held"]["face"]["transform"] = [0, 0.2, -0.2, 0, 100, 100]
    data = whale_motion_archive(model)
    assert read_whale_package(data).model == model
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
            for name in source.namelist():
                if name != "schemes/harness/feat/eyeR_iris.png":
                    target.writestr(name, source.read(name))
    with pytest.raises(ValueError, match="贴图缺失"):
        read_whale_package(output.getvalue())
