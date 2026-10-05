"""Shared timed bridges retain exact source/target registrations within checked ranges."""

from __future__ import annotations

import copy
import json

import httpx
import pytest

from app.apps.desktop_pet.frame_sequences import validate_frame_sequences
from app.apps.desktop_pet.whale_package import read_whale_package
from app.main import app
from test_desktop_pet_frame_sequences import sequence_archive
from test_desktop_pet_sequence_branches import branch_archive, branch_model


def range_model():
    model = branch_model()
    sequences = model["frameSequences"]
    clips = sequences["clips"]
    # Unselected prefix/suffix deliberately do not match the endpoints. End is
    # exclusive, and absolute atlas/anchor coordinates never change per range.
    frames = [copy.deepcopy(clips["walk"]["frames"][3])]
    branches = []
    for branch in sequences["transitions"][-1]["branches"]:
        start = len(frames)
        frames.extend(clips.pop(branch["clip"])["frames"])
        branches.append(
            {"fromFrame": branch["fromFrame"], "clip": "shared", "range": [start, len(frames)]}
        )
    frames.append(copy.deepcopy(clips["walk"]["frames"][2]))
    clips["shared"] = {"frames": frames, "loop": False}
    sequences["transitions"][-1]["branches"] = branches[::-1]
    return model


def test_shared_half_open_ranges_check_the_actual_source_index_and_preserve_all_outfits():
    model = range_model()
    result = read_whale_package(branch_archive(model))
    assert result.model == model
    assert result.model["parts"] == model["parts"]
    assert result.model["feat"] == model["feat"]
    assert [
        branch["range"] for branch in model["frameSequences"]["transitions"][-1]["branches"]
    ] == [[7, 9], [5, 7], [3, 5], [1, 3]]
    for index, scheme in enumerate(model["schemes"]):
        prefix = f"schemes/{scheme['id']}/" if index else ""
        assert f"{prefix}tex/sequence_atlas.png" in result.images


@pytest.mark.parametrize(
    "selected",
    [
        None,
        {},
        "1,3",
        (),
        [],
        [1],
        [1, 3, 5],
        [True, 3],
        [1, False],
        [1.0, 3],
        [1, 3.0],
        [float("nan"), 3],
        [1, float("inf")],
        ["1", 3],
        [-1, 3],
        [0, 0],
        [3, 1],
        [10, 12],
        [1, 11],
        [1, 2],
    ],
)
def test_explicit_range_requires_two_finite_nonboolean_integer_indices_and_two_cels(selected):
    model = range_model()
    model["frameSequences"]["transitions"][-1]["branches"][-1]["range"] = selected
    with pytest.raises(ValueError, match="区间"):
        validate_frame_sequences(model)


@pytest.mark.parametrize("endpoint", [0, 1])
@pytest.mark.parametrize(
    "field", ["texture", "rect", "grip", "foot", "head", "contacts", "supports"]
)
def test_selected_endpoints_check_pixels_and_every_physical_anchor(endpoint, field):
    model = range_model()
    branch = model["frameSequences"]["transitions"][-1]["branches"][-1]
    index = branch["range"][0] if endpoint == 0 else branch["range"][1] - 1
    frame = model["frameSequences"]["clips"]["shared"]["frames"][index]
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


@pytest.mark.parametrize(
    "fault", ["coverage", "duplicate", "index", "loop", "distance", "clip", "unknown"]
)
def test_range_does_not_relax_source_coverage_or_bridge_constraints(fault):
    model = range_model()
    transition = model["frameSequences"]["transitions"][-1]
    branch = transition["branches"][0]
    if fault == "coverage":
        transition["branches"].pop()
    elif fault == "duplicate":
        transition["branches"][1]["fromFrame"] = branch["fromFrame"]
    elif fault == "index":
        branch["fromFrame"] = 4
    elif fault == "loop":
        model["frameSequences"]["clips"]["shared"]["loop"] = True
    elif fault == "distance":
        model["frameSequences"]["clips"]["shared"]["distancePerCycle"] = 32
    elif fault == "clip":
        branch["clip"] = "absent"
    else:
        branch["offset"] = 1
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


def test_absent_range_keeps_the_whole_legacy_clip_including_single_cel_branches():
    model = branch_model()
    assert read_whale_package(branch_archive(model)).model == model
    sequences = model["frameSequences"]
    idle = sequences["clips"]["idle"]["frames"][0]
    sequences["clips"]["walk"]["frames"] = [copy.deepcopy(idle)]
    sequences["clips"]["stop_0"]["frames"] = [copy.deepcopy(idle)]
    transition = sequences["transitions"][-1]
    transition["branches"] = [{"fromFrame": 0, "clip": "stop_0"}]
    assert read_whale_package(branch_archive(model)).model == model
    transition["branches"][0]["range"] = [0, 1]
    with pytest.raises(ValueError, match="区间"):
        validate_frame_sequences(model)
    transition.pop("branches")
    assert read_whale_package(branch_archive(model)).model == model


@pytest.mark.parametrize("use", ["idle", "target"])
def test_partial_range_container_cannot_be_idle_or_any_transition_target(use):
    model = range_model()
    sequences = model["frameSequences"]
    if use == "idle":
        sequences["clips"]["target"] = sequences["clips"].pop("idle")
        sequences["clips"]["idle"] = sequences["clips"].pop("shared")
        transition = sequences["transitions"][-1]
        transition["to"] = "target"
        for branch in transition["branches"]:
            branch["clip"] = "idle"
    else:
        # A flat transition elsewhere in the graph cannot expose the whole
        # container even though the checked ranged link itself targets idle.
        sequences["transitions"][0]["to"] = "shared"
    with pytest.raises(ValueError, match="过渡容器"):
        validate_frame_sequences(model)


@pytest.mark.parametrize("explicit", [False, True])
def test_whole_clip_reference_does_not_infer_a_container_or_reject_old_idle_targets(explicit):
    model = branch_model()
    sequences = model["frameSequences"]
    idle = copy.deepcopy(sequences["clips"]["idle"]["frames"][0])
    sequences["clips"]["idle"] = {
        "frames": [copy.deepcopy(idle), copy.deepcopy(idle)],
        "loop": False,
    }
    sequences["clips"]["walk"]["frames"] = [copy.deepcopy(idle)]
    branch = {"fromFrame": 0, "clip": "idle"}
    if explicit:
        branch["range"] = [0, 2]
    sequences["transitions"][-1]["branches"] = [branch]
    assert read_whale_package(branch_archive(model)).model == model


def test_partial_container_can_be_an_actual_interruption_source_with_all_cels_registered():
    model = range_model()
    sequences = model["frameSequences"]
    source = sequences["clips"]["shared"]["frames"]
    target = sequences["clips"]["idle"]["frames"][0]
    sequences["clips"]["interruptions"] = {"frames": [], "loop": False}
    bridge = sequences["clips"]["interruptions"]["frames"]
    branches = []
    for index, cel in enumerate(source):
        start = len(bridge)
        bridge.extend([copy.deepcopy(cel), copy.deepcopy(target)])
        branches.append(
            {"fromFrame": index, "clip": "interruptions", "range": [start, len(bridge)]}
        )
    sequences["transitions"].append(
        {
            "id": "interrupt",
            "from": "shared",
            "to": "idle",
            "clip": "interruptions",
            "branches": branches,
        }
    )
    assert read_whale_package(branch_archive(model)).model == model


def combination_model(shared):
    """Numerical 4 x 8 phase exits, not candidate artwork or a visual certification."""
    model = branch_model()
    sequences = model["frameSequences"]
    idle = copy.deepcopy(sequences["clips"]["idle"])
    first = copy.deepcopy(sequences["clips"]["walk"]["frames"][0])
    clips = {"idle": idle}
    transitions = []
    for direction in range(4):
        move = f"move_{direction}"
        frames = [dict(copy.deepcopy(first), rect=[16 * index, 0, 16, 16]) for index in range(8)]
        clips[move] = {"frames": frames, "loop": True, "distancePerCycle": 32}
        branches = []
        shared_frames = []
        for index, source in enumerate(frames):
            bridge = [copy.deepcopy(source), copy.deepcopy(idle["frames"][0])]
            name = f"exit_{direction}" if shared else f"exit_{direction}_{index}"
            branch = {"fromFrame": index, "clip": name}
            if shared:
                branch["range"] = [len(shared_frames), len(shared_frames) + 2]
                shared_frames.extend(bridge)
            else:
                clips[name] = {"frames": bridge, "loop": False}
            branches.append(branch)
        if shared:
            clips[f"exit_{direction}"] = {"frames": shared_frames, "loop": False}
        transitions.append(
            {
                "id": f"stop_{direction}",
                "from": move,
                "to": "idle",
                "clip": branches[0]["clip"],
                "branches": branches,
            }
        )
    sequences["clips"] = clips
    sequences["transitions"] = transitions
    return model


def test_37_clip_combination_becomes_nine_shared_clips_without_dropping_phases_or_frames():
    old, shared = combination_model(False), combination_model(True)
    assert [len(model["frameSequences"]["clips"]) for model in (old, shared)] == [37, 9]
    for model in (old, shared):
        seq = model["frameSequences"]
        assert sum(len(clip["frames"]) for clip in seq["clips"].values()) == 97
        assert sum(len(link["branches"]) for link in seq["transitions"]) == 32
        assert len(json.dumps(model).encode()) < 128 * 1024
        dimensions = {
            f"{'schemes/' + scheme['id'] + '/' if index else ''}tex/sequence_atlas.png": (128, 16)
            for index, scheme in enumerate(model["schemes"])
        }
        assert read_whale_package(sequence_archive(model, dimensions=dimensions)).model == model
    for old_link, shared_link in zip(
        old["frameSequences"]["transitions"], shared["frameSequences"]["transitions"], strict=True
    ):
        for old_branch, shared_branch in zip(
            old_link["branches"], shared_link["branches"], strict=True
        ):
            bridge = shared["frameSequences"]["clips"][shared_branch["clip"]]["frames"]
            start, end = shared_branch["range"]
            assert bridge[start:end] == old["frameSequences"]["clips"][old_branch["clip"]]["frames"]


@pytest.mark.parametrize("fault", ["clips", "clip-frames", "total-frames"])
def test_shared_ranges_do_not_expand_existing_clip_and_frame_budgets(fault):
    model = range_model()
    clips = model["frameSequences"]["clips"]
    if fault == "clips":
        for index in range(65 - len(clips)):
            clips[f"extra_{index}"] = copy.deepcopy(clips["idle"])
    elif fault == "clip-frames":
        clips["shared"]["frames"] *= 13
    else:
        for index in range(16):
            clips[f"extra_{index}"] = {
                "frames": [copy.deepcopy(clips["idle"]["frames"][0]) for _ in range(128)],
                "loop": True,
            }
    with pytest.raises(ValueError):
        validate_frame_sequences(model)


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["range", "container-target"])
async def test_range_api_import_cas_and_invalid_updates_preserve_config_and_chat(fault):
    model = range_model()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("ranges.zip", branch_archive(model), "application/zip")},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        baseline = (await client.get(f"{base}/document")).json()
        chat = (await client.get(f"{base}/chat")).json()
        replacement = copy.deepcopy(model)
        replacement["frameSequences"]["clips"]["shared"]["frames"][1]["durationMs"] = 80
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
        conflict = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": str(baseline["revision"])},
            files={"file": ("stale.zip", branch_archive(model), "application/zip")},
        )
        assert conflict.status_code == 409, conflict.text
        invalid = copy.deepcopy(replacement)
        if fault == "range":
            invalid["frameSequences"]["transitions"][-1]["branches"][0]["range"] = [7, 8]
        else:
            invalid["frameSequences"]["transitions"][0]["to"] = "shared"
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
