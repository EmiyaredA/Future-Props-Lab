"""Complete-frame exits register a checked bridge for every actual source cel."""

from __future__ import annotations

import copy

import httpx
import pytest

from app.apps.desktop_pet.frame_sequences import validate_frame_sequences
from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from test_desktop_pet_frame_sequences import sequence_archive, sequence_model


def branch_model():
    model = sequence_model()
    sequences = model["frameSequences"]
    first = sequences["clips"]["walk"]["frames"][0]
    first["contacts"] = {"bottom": [8, 16]}
    first["supports"] = {"legFront": [8, 16]}
    source = [dict(copy.deepcopy(first), rect=[16 * index, 0, 16, 16]) for index in range(4)]
    sequences["clips"]["walk"]["frames"] = source
    idle = sequences["clips"]["idle"]["frames"][0]
    idle["supports"] = {"legFront": [8, 16]}
    branches = []
    for index, frame in enumerate(source):
        clip = f"stop_{index}"
        sequences["clips"][clip] = {
            "frames": [copy.deepcopy(frame), copy.deepcopy(idle)],
            "loop": False,
        }
        branches.append({"fromFrame": index, "clip": clip})
    sequences["transitions"].append(
        {
            "id": "walk-idle",
            "from": "walk",
            "to": "idle",
            # Flat fallback is still a required legacy reference. It cannot
            # contain all four source cels and is not the new branch selector.
            "clip": "start",
            "branches": branches,
        }
    )
    return model


def branch_archive(model):
    dimensions = {
        f"{'schemes/' + scheme['id'] + '/' if index else ''}tex/sequence_atlas.png": (64, 16)
        for index, scheme in enumerate(model["schemes"])
    }
    return sequence_archive(model, dimensions=dimensions)


def test_four_source_cels_have_independent_endpoints_and_all_outfits_keep_legacy_assets():
    model = branch_model()
    result = read_whale_package(branch_archive(model))
    assert result.model == model
    assert len(result.model["frameSequences"]["transitions"][-1]["branches"]) == 4
    assert result.model["parts"] == model["parts"]
    assert result.model["feat"] == model["feat"]
    for index, scheme in enumerate(model["schemes"]):
        prefix = f"schemes/{scheme['id']}/" if index else ""
        assert f"{prefix}tex/sequence_atlas.png" in result.images
        for name in model["feat"]["sprites"]:
            assert f"{prefix}feat/{name}.png" in result.images


@pytest.mark.parametrize(
    "fault",
    [
        "none",
        "empty",
        "missing-source-cel",
        "duplicate-source-cel",
        "negative-index",
        "large-index",
        "float-index",
        "bool-index",
        "string-index",
        "unknown-branch-field",
        "missing-index",
        "missing-clip-key",
        "invalid-branch-object",
        "unknown-clip",
        "invalid-clip-type",
        "loop-bridge",
        "distance-bridge",
        "missing-required-flat-clip",
        "unknown-required-flat-clip",
    ],
)
def test_branch_coverage_indices_references_and_timed_bridge_shape_are_checked(fault):
    model = branch_model()
    transition = model["frameSequences"]["transitions"][-1]
    branches = transition["branches"]
    branch = branches[0]
    if fault == "none":
        transition["branches"] = None
    elif fault == "empty":
        transition["branches"] = []
    elif fault == "missing-source-cel":
        branches.pop()
    elif fault == "duplicate-source-cel":
        branches[1]["fromFrame"] = 0
    elif fault in ("negative-index", "large-index", "float-index", "bool-index", "string-index"):
        branch["fromFrame"] = {
            "negative-index": -1,
            "large-index": 4,
            "float-index": 0.0,
            "bool-index": False,
            "string-index": "0",
        }[fault]
    elif fault == "unknown-branch-field":
        branch["scale"] = 1
    elif fault == "missing-index":
        branch.pop("fromFrame")
    elif fault == "missing-clip-key":
        branch.pop("clip")
    elif fault == "invalid-branch-object":
        branches[0] = 0
    elif fault == "unknown-clip":
        branch["clip"] = "absent"
    elif fault == "invalid-clip-type":
        branch["clip"] = []
    elif fault == "loop-bridge":
        model["frameSequences"]["clips"][branch["clip"]]["loop"] = True
    elif fault == "distance-bridge":
        model["frameSequences"]["clips"][branch["clip"]]["distancePerCycle"] = 32
    elif fault == "missing-required-flat-clip":
        transition.pop("clip")
    else:
        transition["clip"] = "absent"
    with pytest.raises(ValueError):
        read_whale_package(branch_archive(model))


@pytest.mark.parametrize("endpoint", [0, -1])
@pytest.mark.parametrize(
    "field", ["texture", "rect", "grip", "foot", "head", "contacts", "supports"]
)
def test_pixels_and_all_physical_registration_metadata_must_match_each_endpoint(endpoint, field):
    model = branch_model()
    frame = model["frameSequences"]["clips"]["stop_0"]["frames"][endpoint]
    if field == "texture":
        frame[field] = "other_atlas"
    elif field == "rect":
        frame[field][0] += 16
    elif field == "head":
        for point in frame[field]:
            point[0] += 1
    elif field == "contacts":
        frame[field] = {"bottom": [9, 16]}
    elif field == "supports":
        frame[field] = {"legBack": [8, 16]}
    else:
        frame[field][0] += 1
    with pytest.raises(ValueError, match="首尾画面与锚点登记"):
        validate_frame_sequences(model)


def test_duration_is_not_pixel_identity_and_absent_empty_maps_are_equivalent():
    model = branch_model()
    transition = model["frameSequences"]["transitions"][-1]
    transition["branches"].reverse()
    for branch in transition["branches"]:
        bridge = model["frameSequences"]["clips"][branch["clip"]]["frames"]
        bridge[0]["durationMs"] = 80
        bridge[-1]["durationMs"] = 120
        bridge[-1]["contacts"] = {}
    assert read_whale_package(branch_archive(model)).model == model


def test_flat_transition_compatibility_does_not_newly_require_all_phase_bridges():
    model = branch_model()
    model["frameSequences"]["transitions"][-1].pop("branches")
    # Historical flat bridge is deliberately not an all-phase natural stop.
    # Compatibility means legal import, not a runtime support/visual claim.
    assert read_whale_package(branch_archive(model)).model == model


def test_all_128_source_indices_can_reuse_the_same_identical_registered_cel_bridge():
    model = branch_model()
    sequences = model["frameSequences"]
    source = sequences["clips"]["walk"]["frames"][0]
    sequences["clips"]["walk"]["frames"] = [copy.deepcopy(source) for _ in range(128)]
    sequences["transitions"][-1]["branches"] = [
        {"fromFrame": index, "clip": "stop_0"} for index in range(128)
    ]
    assert read_whale_package(branch_archive(model)).model == model


@pytest.mark.asyncio
async def test_branch_import_and_resource_cas_preserve_document_and_reject_invalid_updates():
    model = branch_model()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("branches.zip", branch_archive(model), "application/zip")},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        baseline = (await client.get(f"{base}/document")).json()
        chat = (await client.get(f"{base}/chat")).json()
        assert baseline["whaleModel"]["frameSequences"] == model["frameSequences"]
        replacement = copy.deepcopy(model)
        replacement["frameSequences"]["clips"]["stop_0"]["frames"][0]["durationMs"] = 90
        updated = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("replacement.zip", branch_archive(replacement), "application/zip")},
        )
        assert updated.status_code == 200, updated.text
        saved = updated.json()
        assert saved["revision"] == baseline["revision"] + 1
        assert saved["config"] == baseline["config"]
        assert saved["whaleModel"] == replacement
        assert (await client.get(f"{base}/chat")).json() == chat
        conflict = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("stale.zip", branch_archive(model), "application/zip")},
        )
        assert conflict.status_code == 409, conflict.text
        invalid = copy.deepcopy(replacement)
        invalid["frameSequences"]["transitions"][-1]["branches"].pop()
        bad_import = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("invalid.zip", branch_archive(invalid), "application/zip")},
        )
        assert bad_import.status_code == 422, bad_import.text
        bad_update = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(saved["revision"])},
            files={"file": ("invalid.zip", branch_archive(invalid), "application/zip")},
        )
        assert bad_update.status_code == 422, bad_update.text
        assert (await client.get(f"{base}/document")).json() == saved
        assert (await client.get(f"{base}/chat")).json() == chat
