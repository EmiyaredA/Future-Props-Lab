"""Actual private resource imports enforce transition views, support transfer and outfit assets."""

from __future__ import annotations

import copy
import io
import zipfile

import pytest

from app.apps.desktop_pet.whale_package import read_whale_package
from test_desktop_pet_human import archive, human_model
from test_desktop_pet_motion_rig import (
    articulated_model,
    authored_model,
    whale_authored_model,
    whale_motion_archive,
)


def transition(source="held", target="stand", end=None):
    return {
        "id": f"{source}-{target}",
        "from": {"pose": source, "facing": 1},
        "to": {"pose": target, "facing": 1},
        "durationMs": 300,
        "keyframes": [{"progress": 0, "pose": source}, {"progress": 1, "pose": end}],
    }


def transitional_model():
    model = authored_model()
    pose = copy.deepcopy(model["motionRig"]["poses"]["walk"])
    pose["part"] = "transition_stand"
    model["parts"].append(
        {**copy.deepcopy(model["parts"][0]), "id": pose["part"], "parent": "body"}
    )
    model["motionRig"]["transitions"] = [transition(end=pose)]
    return model


def strip_entry(data, name):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, "w") as target:
        for entry in source.infolist():
            if entry.filename != name:
                target.writestr(entry, source.read(entry))
    return output.getvalue()


def support(edge, point=None):
    return {"edge": edge, "point": point or [110, 195]}


def corner(source, target):
    names = {"left": "side", "right": "side", "top": "top", "bottom": "bottom"}
    # Explicit old/new contacts coexist at the middle keyframe. These are synthetic bindings,
    # not approved artwork or a proof of runtime world-space contact stability.
    anchors = {
        "left": {"armNear": support("left")},
        "right": {"armNear": support("right")},
        "top": {"armFar": support("top")},
        "bottom": {"legFront": support("bottom"), "legBack": support("bottom")},
    }
    return {
        "id": f"corner-{source}-{target}",
        "from": {"pose": names[source], "facing": 1, "edge": source},
        "to": {"pose": names[target], "facing": 1, "edge": target},
        "durationMs": 250,
        "keyframes": [
            {"progress": 0, "pose": names[source], "supports": anchors[source]},
            {"progress": 0.5, "pose": names[source], "supports": anchors[source] | anchors[target]},
            {"progress": 1, "pose": names[target], "supports": anchors[target]},
        ],
    }


def test_inline_stand_recovery_start_stop_turn_reuses_identical_registered_view():
    model = transitional_model()
    stand = model["motionRig"]["transitions"][0]["keyframes"][-1]["pose"]
    start = transition("stand", "walk", "walk")
    start["keyframes"][0]["pose"] = copy.deepcopy(stand)
    stop = transition("walk", "stand", copy.deepcopy(stand))
    turn = transition("walk", "walk", "walk")
    turn["to"]["facing"] = -1
    model["motionRig"]["transitions"].extend([start, stop, turn])
    result = read_whale_package(archive(model))
    assert result.model == model
    assert len({p["id"] for p in result.model["parts"]}) == len(model["parts"])


@pytest.mark.parametrize("profile", ["human", "whale"])
@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize(
    "vertical,horizontal",
    [("top", "left"), ("top", "right"), ("bottom", "left"), ("bottom", "right")],
)
def test_all_directed_corner_handoffs_use_profile_native_views(
    profile, reverse, vertical, horizontal
):
    model = authored_model() if profile == "human" else whale_authored_model()
    source, target = (vertical, horizontal) if reverse else (horizontal, vertical)
    model["motionRig"]["transitions"] = [corner(source, target)]
    writer = archive if profile == "human" else whale_motion_archive
    assert read_whale_package(writer(model)).model == model


def test_whale_inline_view_keeps_native_layer_projection_and_can_share_registered_pose():
    model = whale_authored_model()
    pose = copy.deepcopy(model["motionRig"]["poses"]["walk"])
    model["motionRig"]["transitions"] = [transition(end=pose)]
    result = read_whale_package(whale_motion_archive(model))
    assert result.model == model
    assert "eyes" not in result.model["feat"]["sprites"]
    pose["face"]["transform"][0] = -0.2
    with pytest.raises(ValueError, match="不镜像"):
        read_whale_package(whale_motion_archive(model))


def test_transition_asset_and_crop_checks_cover_every_outfit():
    model = transitional_model()
    model["schemes"].extend([{"id": "lab"}, {"id": "maid"}])
    part = model["parts"][-1]
    part["tex"] = "stand_original"
    stand = model["motionRig"]["transitions"][0]["keyframes"][-1]["pose"]
    stand["face"]["sourceRects"] = {"eyes": [0, 0, 16, 16]}
    packed = archive(model)
    assert read_whale_package(packed).model == model
    for path in ("schemes/lab/tex/stand_original.png", "schemes/maid/feat/eyes.png"):
        with pytest.raises(ValueError):
            read_whale_package(strip_entry(packed, path))
    stand["face"]["sourceRects"]["eyes"] = [0, 0, 17, 16]
    with pytest.raises(ValueError, match="源裁切超出"):
        read_whale_package(archive(model))


@pytest.mark.parametrize("value", [None, {}, "bad", [None], [False]])
def test_transitions_reject_invalid_container(value):
    model = authored_model()
    model["motionRig"]["transitions"] = value
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t.update(script="bad"),
        lambda t: t.update(id="../../path"),
        lambda t: t.update(durationMs=True),
        lambda t: t.update(durationMs=float("inf")),
        lambda t: t.update(durationMs=float("nan")),
        lambda t: t.update(durationMs=79),
        lambda t: t.update(durationMs=1501),
        lambda t: t["from"].update(facing=True),
        lambda t: t["to"].update(pose="missing"),
        lambda t: t["to"].update(edge="left"),
        lambda t: t["from"].update(extra=1),
        lambda t: t["keyframes"].pop(),
        lambda t: t["keyframes"][0].update(progress=0.01),
        lambda t: t["keyframes"][-1].update(progress=0.99),
        lambda t: t["keyframes"][-1].update(progress=True),
        lambda t: t["keyframes"][-1].update(progress=float("nan")),
        lambda t: t["keyframes"][0].update(pose="side"),
        lambda t: t["keyframes"][-1].update(pose="stand"),
        lambda t: t["keyframes"][-1].update(supports=None),
        lambda t: t["keyframes"][-1].update(extra=1),
        lambda t: t["keyframes"][-1]["pose"].update(part="missing"),
        lambda t: t["keyframes"][-1]["pose"]["face"].update(sprites={"eyes": "missing"}),
        lambda t: t["keyframes"][-1]["pose"]["limbs"]["armNear"].update(end=[False, 195]),
        lambda t: t["keyframes"][-1].update(supports={"armNear": support("top", [200, 200])}),
        lambda t: t["keyframes"][-1].update(supports={"legFront": support("top")}),
        lambda t: t["keyframes"][-1].update(supports={"legFront": support("bottom")}),
    ],
)
def test_invalid_transition_data_is_rejected_by_real_package_import(mutate):
    model = transitional_model()
    mutate(model["motionRig"]["transitions"][0])
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


def test_repeated_parts_require_deep_equal_complete_binding():
    model = transitional_model()
    other = copy.deepcopy(model["motionRig"]["transitions"][0])
    other.update(id="stop", **{"from": {"pose": "walk", "facing": 1}})
    other["keyframes"][0]["pose"] = "walk"
    other["keyframes"][-1]["pose"]["face"]["angle"] = 1
    model["motionRig"]["transitions"].append(other)
    with pytest.raises(ValueError, match="不同姿势绑定"):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "fault",
    [
        "duplicate_id",
        "duplicate_direction",
        "unordered",
        "too_many_frames",
        "too_many_transitions",
        "no_transfer",
        "missing_support",
        "opposite_edges",
    ],
)
def test_transition_limits_and_handoffs_reject_ambiguity(fault):
    model = authored_model()
    t = corner("left", "top")
    values = [t]
    if fault == "duplicate_id":
        values.append(copy.deepcopy(t))
    elif fault == "duplicate_direction":
        values.append({**copy.deepcopy(t), "id": "other"})
    elif fault == "unordered":
        t["keyframes"][1]["progress"] = 0
    elif fault == "too_many_frames":
        t["keyframes"] *= 3
    elif fault == "too_many_transitions":
        values *= 33
    elif fault == "no_transfer":
        t["keyframes"][1]["supports"] = {"armFar": support("top")}
    elif fault == "missing_support":
        t["keyframes"][1].pop("supports")
    else:
        t["to"].update(pose="side", edge="right")
    model["motionRig"]["transitions"] = values
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


def test_legacy_profiles_remain_compatible_without_transitions_and_v1_cannot_smuggle_them():
    for model in (human_model(), articulated_model(), authored_model()):
        assert read_whale_package(archive(model)).model == model
    model = articulated_model()
    model["motionRig"]["transitions"] = []
    with pytest.raises(ValueError, match="仅支持版本二"):
        read_whale_package(archive(model))
    model = authored_model()
    model["motionRig"]["transitions"] = []
    assert read_whale_package(archive(model)).model == model


def test_preexisting_optional_null_view_bindings_keep_legacy_import_behavior():
    model = authored_model()
    for pose in model["motionRig"]["poses"].values():
        pose["head"] = None
        for limb in pose["limbs"].values():
            limb.update(part=None, segments=None)
    assert read_whale_package(archive(model)).model == model


def test_transition_views_never_raise_resource_part_budget():
    model = transitional_model()
    while len(model["parts"]) <= 128:
        model["parts"].append(
            {**copy.deepcopy(model["parts"][0]), "id": f"extra_{len(model['parts'])}"}
        )
    with pytest.raises(ValueError, match="模型结构无效"):
        read_whale_package(archive(model))


@pytest.mark.parametrize("basis", [None, True, 0, 2, 1.0, float("nan"), "left"])
def test_explicit_invalid_view_basis_is_rejected(basis):
    model = transitional_model()
    model["motionRig"]["transitions"][0]["keyframes"][0]["viewFacing"] = basis
    with pytest.raises(ValueError, match="显示坐标基准|非法数字"):
        read_whale_package(archive(model))


def test_explicit_view_basis_and_legacy_omission_are_preserved():
    model = transitional_model()
    assert read_whale_package(archive(model)).model == model
    for frame, basis in zip(
        model["motionRig"]["transitions"][0]["keyframes"], (1, -1), strict=True
    ):
        frame["viewFacing"] = basis
    assert read_whale_package(archive(model)).model == model


@pytest.mark.parametrize("edge,pose", [("top", "top"), ("bottom", "bottom"), ("left", "side")])
@pytest.mark.parametrize("release", [False, True])
def test_attached_endpoint_requires_contact_even_without_corner(edge, pose, release):
    model = authored_model()
    t = transition("held", pose, pose)
    t["to"]["edge"] = edge
    if release:
        t["from"], t["to"] = t["to"], t["from"]
        t["keyframes"].reverse()
        for frame, progress in zip(t["keyframes"], (0, 1), strict=True):
            frame["progress"] = progress
    model["motionRig"]["transitions"] = [t]
    with pytest.raises(ValueError, match="缺少对应边缘支撑"):
        read_whale_package(archive(model))
    anchors = {"armNear": support(edge)}
    if edge == "bottom":
        anchors = {"legBack": support(edge), "legFront": support(edge)}
    t["keyframes"][0 if release else -1]["supports"] = anchors
    assert read_whale_package(archive(model)).model == model


@pytest.mark.parametrize("fault", ["empty", "changed_limb", "wrong_edge"])
def test_same_edge_direction_change_requires_continuous_support(fault):
    model = authored_model()
    t = transition("side", "side", "side")
    t["from"]["edge"] = t["to"]["edge"] = "left"
    t["to"]["facing"] = -1
    for frame in t["keyframes"]:
        frame["supports"] = {"armNear": support("left")}
    model["motionRig"]["transitions"] = [t]
    assert read_whale_package(archive(model)).model == model
    t["keyframes"][-1]["supports"] = {
        "empty": {},
        "changed_limb": {"armFar": support("left")},
        "wrong_edge": {"armNear": support("right")},
    }[fault]
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


@pytest.mark.parametrize(
    "edge,pose", [("left", "side"), ("right", "side"), ("top", "top"), ("bottom", "bottom")]
)
@pytest.mark.parametrize("profile", ["human", "whale"])
def test_same_edge_supports_must_share_actual_contact_plane(edge, pose, profile):
    model = authored_model() if profile == "human" else whale_authored_model()
    writer = archive if profile == "human" else whale_motion_archive
    t = transition(pose, pose, pose)
    t["from"]["edge"] = t["to"]["edge"] = edge
    t["to"]["facing"] = -1
    pair = ("legBack", "legFront") if edge == "bottom" else ("armNear", "armFar")
    for frame in t["keyframes"]:
        frame["supports"] = {limb: support(edge) for limb in pair}
    model["motionRig"]["transitions"] = [t]
    assert read_whale_package(writer(model)).model == model
    axis = 0 if edge in ("left", "right") else 1
    # Each declared support still matches its own registered geometry exactly;
    # only their shared wall/floor/ceiling plane is inconsistent.
    contact = [110, 195]
    contact[axis] += 2
    model["motionRig"]["poses"][pose]["limbs"][pair[1]]["contact"] = contact
    for frame in t["keyframes"]:
        frame["supports"][pair[1]]["point"] = contact.copy()
    with pytest.raises(ValueError, match="支点必须共面"):
        read_whale_package(writer(model))
