"""Normal public APIs drive a real native lane with a deterministic isolated Mac worker."""

import io
import json
import wave
from uuid import uuid4

import httpx

MODEL = "qwen3-tts-0.6b-base"


def exercise_native_models(*, client, unsafe, wait, compose, management_origin, password, root):
    def installed(response):
        return response.status_code == 200 and any(
            item["id"] == MODEL and item["status"] == "installed" and item["enabled"]
            for item in response.json()["items"]
        )

    reported = wait(
        client,
        "/v1/local-models",
        lambda response: (
            response.status_code == 200
            and any(item["id"] == MODEL and item["compatible"] for item in response.json()["items"])
        ),
    )
    model = next(item for item in reported.json()["items"] if item["id"] == MODEL)
    with httpx.Client(
        base_url=management_origin,
        trust_env=False,
        timeout=10,
        headers={"Origin": management_origin},
    ) as management:
        login = management.post(
            "/v1/auth/login", json={"username": "isolated-admin", "password": password}
        )
        assert login.status_code == 200, login.text
        management.headers["X-CSRF-Token"] = management.cookies["fpl_management_csrf"]
        body = {
            "request_id": uuid4().hex,
            "expected_revision": model["revision"],
            "action": "install",
        }
        path = "/v1/platform/local-models/" + MODEL + "/actions"
        accepted = management.post(path, json=body)
        assert accepted.status_code == 200, accepted.text
        duplicate = management.post(path, json=body)
        assert duplicate.status_code == 200 and duplicate.json() == accepted.json(), duplicate.text
    wait(client, "/v1/local-models", installed)
    catalog = client.get("/v1/model-providers").json()
    attached = client.post(
        "/v1/local-models/attach",
        headers=unsafe,
        json={"model_id": MODEL, "expected_catalog_revision": catalog["revision"]},
    )
    assert attached.status_code == 200, attached.text
    model_id = next(
        model["id"]
        for provider in attached.json()["providers"]
        for model in provider["models"]
        if model["slug"] == MODEL
    )
    recording = io.BytesIO()
    with wave.open(recording, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\0\0" * 8000 * 4)
    upload = client.post(
        "/v1/model-inference/assets",
        headers=unsafe,
        files={"upload": ("reference.wav", recording.getvalue(), "audio/wav")},
    )
    assert upload.status_code == 200, upload.text
    asset_id = upload.json()["id"]
    body = {
        "request_id": uuid4().hex,
        "model_id": model_id,
        "kind": "speech_synthesis",
        "asset_ids": [asset_id],
        "parameters": {
            "text": "隔离原生工作进程验证",
            "language": "Chinese",
            "reference_text": "合成参考录音",
            "reference_asset_id": asset_id,
        },
    }
    created = client.post("/v1/model-inference/tasks", headers=unsafe, json=body)
    assert created.status_code == 200, created.text
    replay = client.post("/v1/model-inference/tasks", headers=unsafe, json=body)
    assert replay.status_code == 200 and replay.json()["id"] == created.json()["id"], replay.text
    task_path = "/v1/model-inference/tasks/" + created.json()["id"]
    finished = wait(
        client,
        task_path,
        lambda response: (
            response.status_code == 200 and response.json()["status"] in {"completed", "failed"}
        ),
    ).json()
    assert finished["status"] == "completed", finished
    content = client.get(task_path + "/content")
    assert content.status_code == 200 and content.content == recording.getvalue(), content.text[
        :100
    ]
    first = client.post(task_path + "/save-to-library", headers=unsafe)
    assert first.status_code == 200, first.text
    second = client.post(task_path + "/save-to-library", headers=unsafe)
    assert second.status_code == 200 and second.json()["id"] == first.json()["id"], second.text
    copied = client.get("/v1/files/" + first.json()["id"] + "/content")
    assert copied.status_code == 200 and copied.content == recording.getvalue()
    compose("up", "--detach", "--no-deps", "--force-recreate", "models")
    recovered = wait(client, task_path).json()
    assert recovered["status"] == "completed"
    assert client.get(task_path + "/content").content == recording.getvalue()
    saved_again = client.post(task_path + "/save-to-library", headers=unsafe)
    assert saved_again.status_code == 200 and saved_again.json()["id"] == first.json()["id"]
    count = json.loads((root / "native-model-state/synthesis-count.json").read_text())
    assert count == 1
    return (
        "Native model install and speech use lease-scoped bytes, one execution "
        "and idempotent library delivery across Models restart without mounting Mac data"
    )
