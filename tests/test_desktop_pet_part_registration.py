"""Public package imports enforce static registration without accepting executable GPU meshes."""

from __future__ import annotations

import copy

import httpx
import pytest

from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from test_desktop_pet import whale_archive
from test_desktop_pet_human import archive, human_model
from test_desktop_pet_motion_rig import (
    articulated_model,
    authored_model,
    segmented_model,
    whale_authored_model,
    whale_motion_archive,
)
from test_desktop_pet_transitions import transition


def registered_model(whale=False):
    model = whale_authored_model() if whale else segmented_model()
    part_id = model["motionRig"]["poses"]["walk"]["limbs"]["armNear"]["segments"][0]
    part = next(part for part in model["parts"] if part["id"] == part_id)
    part["restTransform"] = {"angle": -47.5, "pivot": [100, 150]}
    return model, part


@pytest.mark.parametrize("whale", [False, True])
def test_rigid_source_registration_preserves_both_complete_profile_packages(whale):
    model, _ = registered_model(whale)
    data = whale_motion_archive(model) if whale else archive(model)
    assert read_whale_package(data).model == model


@pytest.mark.parametrize(
    "transform",
    [
        None,
        [],
        {"angle": 181, "pivot": [0, 0]},
        {"angle": -181, "pivot": [0, 0]},
        {"angle": True, "pivot": [0, 0]},
        {"angle": float("nan"), "pivot": [0, 0]},
        {"angle": 1, "pivot": [0, 513]},
        {"angle": 1, "pivot": [True, 0]},
        {"angle": 1, "pivot": [0]},
        {"angle": 1, "pivot": [0, 0, 0]},
        {"angle": 1, "pivot": [0, float("inf")]},
        {"angle": 1},
        {"angle": 1, "pivot": [0, 0], "scale": 2},
    ],
)
@pytest.mark.parametrize("whale", [False, True])
def test_registration_rejects_nonfinite_out_of_range_and_unknown_keys(transform, whale):
    model, part = registered_model(whale)
    part["restTransform"] = transform
    with pytest.raises(ValueError):
        read_whale_package(whale_motion_archive(model) if whale else archive(model))


@pytest.mark.parametrize("angle", [-180, 0, 180])
def test_registration_inclusive_finite_bounds(angle):
    model, part = registered_model()
    part["restTransform"] = {"angle": angle, "pivot": [-512, 512]}
    assert read_whale_package(archive(model)).model == model


@pytest.mark.parametrize("kind", ["core", "whole", "head", "skin", "legacy", "v1"])
def test_registration_only_on_validated_v2_rigid_segments(kind):
    model, part = registered_model()
    if kind in {"core", "whole", "head"}:
        model = authored_model()
        pose = model["motionRig"]["poses"]["walk"]
        if kind == "head":
            part = {**copy.deepcopy(model["parts"][0]), "id": "walk_head", "parent": "body"}
            model["parts"].append(part)
            pose["head"] = {"part": part["id"], "neck": [100, 150]}
        elif kind == "whole":
            part = {**copy.deepcopy(model["parts"][0]), "id": "walk_arm", "parent": "body"}
            model["parts"].append(part)
            pose["limbs"]["armNear"]["part"] = part["id"]
        else:
            part = next(p for p in model["parts"] if p["id"] == pose["part"])
    elif kind == "skin":
        part["skin"] = []
    else:
        model = human_model() if kind == "legacy" else articulated_model()
        part = model["parts"][0]
    part["restTransform"] = {"angle": 45, "pivot": [100, 150]}
    with pytest.raises(ValueError):
        read_whale_package(archive(model))


def test_inline_transition_registration_is_resolved_and_complete_views_can_reuse_it():
    model, _ = registered_model()
    pose = copy.deepcopy(model["motionRig"]["poses"]["walk"])
    ids = [pose["part"], *(part for limb in pose["limbs"].values() for part in limb["segments"])]
    replacement = {part: f"stand_{part}" for part in ids}
    pose["part"] = replacement[pose["part"]]
    for limb in pose["limbs"].values():
        limb["segments"] = [replacement[part] for part in limb["segments"]]
    for part in model["parts"][:]:
        if part["id"] in replacement:
            model["parts"].append({**copy.deepcopy(part), "id": replacement[part["id"]]})
    start = transition("stand", "walk", "walk")
    start["keyframes"][0]["pose"] = copy.deepcopy(pose)
    model["motionRig"]["transitions"] = [transition(end=pose), start]
    assert len(model["parts"]) <= 128
    assert read_whale_package(archive(model)).model == model


@pytest.mark.parametrize("field", ["mesh", "restAngle"])
@pytest.mark.parametrize("factory", [human_model, articulated_model, segmented_model])
def test_never_supported_uploaded_runtime_fields_rejected_without_forbidding_other_legacy_keys(
    field, factory
):
    model = factory()
    model["parts"][0]["futureMetadata"] = "legacy metadata remains compatible"
    assert read_whale_package(archive(model)).model == model
    model["parts"][0][field] = {} if field == "mesh" else 10
    with pytest.raises(ValueError, match="不支持运行时网格"):
        read_whale_package(archive(model))


def test_old_profiles_and_full_views_without_registration_remain_compatible():
    for factory in (human_model, articulated_model, authored_model, segmented_model):
        model = factory()
        assert read_whale_package(archive(model)).model == model
    assert read_whale_package(whale_archive()).model.get("motionRig") is None


@pytest.mark.asyncio
async def test_public_import_and_cas_replace_reject_json_mesh_without_changing_baseline():
    model, part = registered_model()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("registration.zip", archive(model), "application/zip")},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        baseline = (await client.get(f"{base}/document")).json()
        assert next(p for p in baseline["whaleModel"]["parts"] if p["id"] == part["id"])[
            "restTransform"
        ] == part["restTransform"]
        part["mesh"] = {"positions": [0, 0, 1, 0, 0, 1], "indices": [0, 1, 2]}
        bad_data = archive(model)
        rejected = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("mesh.zip", bad_data, "application/zip")},
        )
        assert rejected.status_code == 422, rejected.text
        replaced = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("mesh.zip", bad_data, "application/zip")},
        )
        assert replaced.status_code == 422, replaced.text
        assert (await client.get(f"{base}/document")).json() == baseline
