from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.llm.providers.zealman_video import create_task, get_task, root_url, upload_reference
from app.llm.providers.zealman_workflows import (
    U06,
    U17,
    WORKFLOWS,
    normalize_parameters,
    prepare_workflow,
)


def template(model: str) -> dict:
    contract = WORKFLOWS[model]
    graph = {}

    def node(identity, kind, **inputs):
        graph[identity] = {"class_type": kind, "inputs": inputs}

    prompt_id, prompt_class, prompt_field = contract["prompt"]
    node(prompt_id, prompt_class, **{prompt_field: "private upstream example"})
    node("132", "PrimitiveFloat", value=5)
    node("131", "ComfyMathExpression", **{"values.a": ["132", 0]})
    node("115", "ResolutionSelector", megapixels=0.9)
    node("182", "PrimitiveFloat", value=1.5)
    node("665", "WJILatentPreset")
    node("142", "easy seed", seed=123)
    ref = {"prompt": [prompt_id, 0], "length": ["131", 1]}
    for kind, plural, loader in (
        ("image", "images", "LoadImage"),
        ("audio", "audios", "LoadAudio"),
        ("video", "videos", "VHS_LoadVideo"),
    ):
        for index, identity in enumerate(contract[plural]):
            node(identity, loader, **{kind: "upstream-example"})
            preprocess = f"pre-{identity}"
            node(preprocess, "Preprocess", source=[identity, 0])
            ref[f"ref_{plural}.ref_{kind}_{index}"] = [preprocess, 0]
    ref.update(
        width=["115" if model == U17 else "665", 0 if model == U17 else 1],
        height=["115" if model == U17 else "665", 1 if model == U17 else 2],
    )
    if model == U06:
        ref["seed"] = ["142", 0]
    node(contract["reference"], "MiniMaxH3ReferenceToVideo", **ref)
    output, kind = contract["output"]
    node(output, kind, video=[contract["reference"], 0])
    graph["_api_config"] = {"formValues": {"prompt": "never reuse this"}}
    return graph


@pytest.mark.parametrize("model", [U06, U17])
def test_sparse_references_override_prompt_and_prune_examples_without_mutating_source(model):
    source = template(model)
    before = json.dumps(source)
    graph = prepare_workflow(
        source,
        model,
        {"prompt": "my actual prompt", "duration": 7},
        {"image": ["first.png", "second.png"], "audio": ["voice.wav"]},
    )
    assert json.dumps(source) == before
    assert "_api_config" not in graph
    prompt_id, _, field = WORKFLOWS[model]["prompt"]
    assert graph[prompt_id]["inputs"][field] == "my actual prompt"
    assert graph["132"]["inputs"]["value"] == 7
    images = WORKFLOWS[model]["images"]
    assert graph[images[0]]["inputs"]["image"] == "first.png"
    assert graph[images[1]]["inputs"]["image"] == "second.png"
    assert all(identity not in graph for identity in images[2:])
    assert all(identity not in graph for identity in WORKFLOWS[model]["audios"][1:])
    assert "upstream-example" not in json.dumps(graph)


@pytest.mark.parametrize("model", [U06, U17])
def test_all_reference_slots_and_parameter_snapshot(model):
    contract = WORKFLOWS[model]
    refs = {
        kind: [f"{kind}-{i}" for i in range(len(contract[plural]))]
        for kind, plural in (("image", "images"), ("audio", "audios"), ("video", "videos"))
    }
    params = normalize_parameters(model, {})
    graph = prepare_workflow(
        template(model),
        model,
        {"prompt": "test", "duration": 5, "workflow_parameters": params},
        refs,
    )
    for kind, plural in (("image", "images"), ("audio", "audios"), ("video", "videos")):
        for i, identity in enumerate(contract[plural]):
            assert graph[identity]["inputs"][kind] == f"{kind}-{i}"
    if model == U06:
        assert graph["142"]["inputs"]["seed"] == params["seed"]
        assert graph["665"]["inputs"]["自定义宽"] == 1344
    else:
        assert graph["115"]["inputs"]["aspect_ratio"] == "16:9 (Widescreen)"


def test_changed_reference_mapping_and_unsupported_parameters_are_rejected():
    source = template(U17)
    source["275"]["inputs"]["ref_images.ref_image_0"] = ["249", 0]
    with pytest.raises(ValueError, match="参考连线"):
        prepare_workflow(source, U17, {"prompt": "x", "duration": 5}, {})
    for model, params in [
        (U06, {"width": 641}),
        (U06, {"megapixels": 1}),
        (U17, {"upscale_factor": 3}),
        (U17, {"megapixels": float("nan")}),
    ]:
        with pytest.raises(ValueError):
            normalize_parameters(model, params)
    with pytest.raises(ValueError, match="视频参考数量|video参考数量"):
        prepare_workflow(template(U06), U06, {"prompt": "x", "duration": 5}, {"video": ["v"]})


@pytest.mark.asyncio
async def test_upload_uses_unique_names_and_submission_has_no_implicit_credentials(tmp_path: Path):
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path.endswith("/upload/file"):
            return httpx.Response(200, json={"name": "uploaded.png", "subfolder": "fpl"})
        if request.method == "GET":
            return httpx.Response(200, json=template(U17))
        return httpx.Response(200, json={"success": True, "prompt_id": "one-task"})

    transport = httpx.MockTransport(respond)
    path = tmp_path / "reference.png"
    path.write_bytes(b"png")
    for _ in range(2):
        assert (
            await upload_reference(
                base_url="https://example.test/?_=123",
                api_key="",
                path=path,
                mime_type="image/png",
                transport=transport,
            )
            == "fpl/uploaded.png"
        )
    assert requests[0].content != requests[1].content
    identity = await create_task(
        base_url="https://example.test/",
        api_key="",
        model=U17,
        payload={"prompt": "x", "duration": 5},
        references={"image": ["fpl/uploaded.png"]},
        transport=transport,
    )
    assert identity == "one-task"
    assert all("authorization" not in r.headers for r in requests)
    submitted = json.loads(requests[-1].content)
    assert submitted["workflow_id"] == U17
    assert submitted["workflow_template"]["248"]["inputs"]["image"] == "fpl/uploaded.png"
    assert root_url("https://example.test/?_=123#x") == "https://example.test"


@pytest.mark.asyncio
async def test_submission_timeout_is_not_retried():
    submitted = 0

    def respond(request):
        nonlocal submitted
        if request.method == "GET":
            return httpx.Response(200, json=template(U06))
        submitted += 1
        raise httpx.ReadTimeout("interrupted", request=request)

    with pytest.raises(httpx.ReadTimeout):
        await create_task(
            base_url="https://example.test",
            api_key="",
            model=U06,
            payload={"prompt": "x", "duration": 5},
            references={},
            transport=httpx.MockTransport(respond),
        )
    assert submitted == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["completed", "failed", "ledger", "pending", "missing"])
async def test_result_polling_normalizes_outputs_errors_and_restart_recovery(mode):
    def respond(request):
        if request.url.path.endswith("/result"):
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "pending": mode != "missing",
                    "results": [
                        {"type": "image", "url": "/preview.png"},
                        {"type": "video", "url": "/output/final.mp4"},
                    ]
                    if mode == "completed"
                    else [],
                },
            )
        if request.url.path.endswith("/history"):
            return httpx.Response(
                200,
                json={
                    "task": {
                        "status": {
                            "status_str": "error",
                            "messages": [
                                ["execution_error", {"exception_message": "model unavailable"}]
                            ],
                        }
                    }
                }
                if mode == "failed"
                else {},
            )
        if mode == "ledger":
            return httpx.Response(
                200, json={"task": {"outputs": [{"type": "video", "url": "/output/recovered.mp4"}]}}
            )
        return httpx.Response(404)

    status = await get_task(
        base_url="https://example.test:8443",
        api_key="",
        task_id="task",
        transport=httpx.MockTransport(respond),
    )
    expected = {
        "completed": "completed",
        "failed": "failed",
        "ledger": "completed",
        "pending": "pending",
        "missing": "failed",
    }
    assert status.status == expected[mode]
    if mode in {"ledger", "completed"}:
        assert status.result_url.startswith("https://example.test:8443/output/")


@pytest.mark.parametrize(
    "ratio,expected", [("9:16", "9:16 (Portrait Widescreen)"), ("3:4", "3:4 (Portrait Standard)")]
)
def test_portrait_ratio_values_match_comfyui_resolution_selector(ratio, expected):
    graph = prepare_workflow(template(U17), U17, {"prompt": "x", "duration": 5, "ratio": ratio}, {})
    assert graph["115"]["inputs"]["aspect_ratio"] == expected
