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
    normalize_request,
    prepare_input_values,
)
from studio.contracts.model_service.workflow_video import WorkflowVideoParameters


@pytest.mark.parametrize(
    "model,parameters,expected",
    [
        (
            U17,
            {"megapixels": 0.5, "upscale_factor": 1.2},
            {"megapixels": 0.5, "upscale_factor": 1.2},
        ),
        (U06, {"width": 640, "height": 480, "seed": 0}, {"width": 640, "height": 480, "seed": 0}),
    ],
)
def test_canvas_parameter_roundtrip_omits_null_fields_without_losing_values(
    model, parameters, expected
):
    serialized = WorkflowVideoParameters(**parameters).model_dump(mode="json")
    before = dict(serialized)
    assert normalize_parameters(model, serialized) == expected
    assert serialized == before


def test_null_workflow_parameters_use_defaults_but_unknown_names_stay_invalid():
    assert normalize_parameters(U17, WorkflowVideoParameters().model_dump()) == {
        "megapixels": 0.9,
        "upscale_factor": 1.5,
    }
    for parameters in ({"unknown": None}, {"width": 640}):
        with pytest.raises(ValueError, match="不支持"):
            normalize_parameters(U17, parameters)


@pytest.mark.parametrize("model", [U17, U06])
def test_nullable_generic_video_fields_are_absent_for_workflows(model):
    payload = {
        "prompt": "test",
        "duration": 4,
        "mode": "reference",
        "ratio": None,
        "resolution": None,
        "watermark": None,
        "generate_audio": None,
    }
    normalized = normalize_request(model, payload, set(payload))
    assert not {"resolution", "watermark", "generate_audio"} & normalized.keys()
    assert normalized.get("ratio") == ("16:9" if model == U17 else None)
    with pytest.raises(ValueError, match="不支持"):
        normalize_request(model, {**payload, "generate_audio": False}, set(payload))


def test_implicit_schema_ratio_is_not_a_requested_u06_parameter():
    normalized = normalize_request(
        U06,
        {"prompt": "test", "duration": 4, "mode": "text", "ratio": "16:9"},
        {"prompt", "duration", "mode"},
    )
    assert "ratio" not in normalized


@pytest.mark.parametrize("model", [U06, U17])
def test_sparse_references_use_fixed_zero_based_names_without_reordering_or_mutation(model):
    refs = {"image": ["second.png", "first.png"], "audio": ["voice.wav"]}
    payload = {"prompt": "my actual prompt", "duration": 7}
    before = json.dumps([refs, payload])
    values = prepare_input_values(
        model,
        payload,
        refs,
    )
    assert json.dumps([refs, payload]) == before
    assert values["prompt"] == "my actual prompt"
    assert values["value"] == 7
    assert values["ref_image_0"] == "second.png"
    assert values["ref_image_1"] == "first.png"
    assert values["ref_audio_0"] == "voice.wav"
    assert {k for k in values if k.startswith("ref_")} == {
        "ref_image_0",
        "ref_image_1",
        "ref_audio_0",
    }
    assert all(":" not in key and not key.isdecimal() for key in values)


@pytest.mark.parametrize("model", [U06, U17])
def test_all_reference_slots_and_parameter_snapshot(model):
    contract = WORKFLOWS[model]
    refs = {kind: [f"{kind}-{i}" for i in range(limit)] for kind, limit in contract.items()}
    params = normalize_parameters(model, {})
    values = prepare_input_values(
        model,
        {"prompt": "test", "duration": 5, "workflow_parameters": params},
        refs,
    )
    for kind, limit in contract.items():
        for i in range(limit):
            assert values[f"ref_{kind}_{i}"] == f"{kind}-{i}"
    if model == U06:
        assert values["seed"] == params["seed"]
        assert values["param_4"] == 1344
        assert values["param_5"] == 768
    else:
        assert values["aspect_ratio"] == "16:9 (Widescreen)"
        assert values["megapixels"] == params["megapixels"]
        assert values["value_2"] == params["upscale_factor"]


def test_unsupported_parameters_and_invalid_references_are_rejected():
    for model, params in [
        (U06, {"width": 641}),
        (U06, {"megapixels": 1}),
        (U17, {"upscale_factor": 3}),
        (U17, {"megapixels": float("nan")}),
    ]:
        with pytest.raises(ValueError):
            normalize_parameters(model, params)
    with pytest.raises(ValueError, match="视频参考数量|video参考数量"):
        prepare_input_values(U06, {"prompt": "x", "duration": 5}, {"video": ["v"]})
    for refs in ({"image": ["ok.png", ""]}, {"image": [None]}, {"images": ["x.png"]}):
        with pytest.raises(ValueError, match="参考素材"):
            prepare_input_values(U17, {"prompt": "x", "duration": 5}, refs)


@pytest.mark.asyncio
async def test_upload_uses_unique_names_and_submission_has_no_implicit_credentials(tmp_path: Path):
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path.endswith("/upload/file"):
            return httpx.Response(200, json={"name": "uploaded.png", "subfolder": "fpl"})
        assert request.method == "POST"
        assert request.url.path == "/api/workflow/generate"
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
        payload={
            "prompt": "图1人设，图2首帧，图3尾帧，视频1动作",
            "duration": 7,
            "ratio": "16:9",
            "workflow_parameters": {"megapixels": 0.9, "upscale_factor": 1.5},
        },
        references={
            "image": ["fpl/identity.png", "fpl/start.png", "fpl/end.png"],
            "video": ["fpl/motion.mp4"],
            "audio": [],
        },
        transport=transport,
    )
    assert identity == "one-task"
    assert all("authorization" not in r.headers for r in requests)
    submitted = json.loads(requests[-1].content)
    assert submitted.pop("client_id").startswith("fpl-")
    assert submitted == {
        "workflow_id": U17,
        "source": "api",
        "input_values": {
            "prompt": "图1人设，图2首帧，图3尾帧，视频1动作",
            "value": 7,
            "aspect_ratio": "16:9 (Widescreen)",
            "megapixels": 0.9,
            "value_2": 1.5,
            "ref_image_0": "fpl/identity.png",
            "ref_image_1": "fpl/start.png",
            "ref_image_2": "fpl/end.png",
            "ref_video_0": "fpl/motion.mp4",
        },
    }
    assert root_url("https://example.test/?_=123#x") == "https://example.test"


@pytest.mark.asyncio
async def test_submission_timeout_is_not_retried():
    submitted = 0

    def respond(request):
        nonlocal submitted
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
@pytest.mark.parametrize("endpoint", ["result", "history"])
@pytest.mark.parametrize("failure", ["http", "transport"])
@pytest.mark.parametrize(
    "bucket,expected", [("queue_running", "processing"), ("queue_pending", "pending")]
)
async def test_polling_failure_preserves_job_with_positive_queue_evidence(
    endpoint, failure, bucket, expected
):
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path.endswith("/" + endpoint):
            if failure == "transport":
                raise httpx.ReadTimeout("query timeout", request=request)
            return httpx.Response(500, json={"error": "ComfyUI history request timeout"})
        if request.url.path.endswith("/result"):
            return httpx.Response(200, json={"pending": True})
        if request.url.path.endswith("/tasks/task"):
            return httpx.Response(200, json={"task": {"status": "running", "progress": 78}})
        if request.url.path.endswith("/queue"):
            return httpx.Response(200, json={bucket: [[0, "task", {}]]})
        return httpx.Response(404)

    status = await get_task(
        base_url="https://example.test",
        api_key="",
        task_id="task",
        transport=httpx.MockTransport(respond),
    )
    assert status.status == expected
    assert status.execution_info.reported_progress == 78
    assert all(request.method == "GET" for request in requests)
    assert sum(request.url.path.endswith("/" + endpoint) for request in requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "evidence,expected",
    [("missing", None), ("stale", None), ("completed", "completed"), ("failed", "failed")],
)
async def test_polling_failure_requires_live_evidence_or_definitive_ledger(evidence, expected):
    def respond(request):
        if request.url.path.endswith("/result"):
            return httpx.Response(500, json={"error": "history request timeout"})
        if request.url.path.endswith("/tasks/task"):
            task = {"status": "running"} if evidence == "stale" else {}
            if evidence == "completed":
                task = {
                    "status": "completed",
                    "outputs": [{"type": "video", "url": "/output/late.mp4"}],
                }
            if evidence == "failed":
                task = {"status": "failed", "error": "actual execution failure"}
            return httpx.Response(200, json={"task": task})
        return httpx.Response(200, json={"queue_running": [], "queue_pending": []})

    if expected is None:
        with pytest.raises(httpx.HTTPStatusError):
            await get_task(
                base_url="https://example.test",
                api_key="",
                task_id="task",
                transport=httpx.MockTransport(respond),
            )
    else:
        status = await get_task(
            base_url="https://example.test",
            api_key="",
            task_id="task",
            transport=httpx.MockTransport(respond),
        )
        assert status.status == expected
        if expected == "completed":
            assert status.result_url == "https://example.test/output/late.mp4"
        else:
            assert status.error_message == "actual execution failure"


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
    values = prepare_input_values(U17, {"prompt": "x", "duration": 5, "ratio": ratio}, {})
    assert values["aspect_ratio"] == expected
