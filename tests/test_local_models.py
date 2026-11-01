"""Optional local runtime: deterministic install, permission, download and inference checks."""

import asyncio
import hashlib
import io
import json
import sys
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import delete

from app.console.governance.local_models import can_manage_local_models
from app.llm.local_models import worker
from app.llm.local_models.catalog import credential_ready, definition, manifest
from app.llm.local_models.downloads import fetch_file
from app.llm.local_models.installer import Installer
from app.llm.local_models.management import LocalModels
from app.llm.local_models.runtime import LocalRuntime
from app.llm.models.local_models import LocalModelInstallation, LocalModelOperation
from app.llm.schemas.local_models import LocalModelActionIn, SpeechSynthesisParameters
from app.llm.schemas.model_service import ProviderIn
from app.main import app
from app.runtime.db import SessionLocal
from app.runtime.operation_receipts import OperationError
from app.runtime.revisions import RevisionConflictError

MODEL = "qwen3-tts-0.6b-base"


def test_worker_writes_wav_to_extensionless_asset_key(monkeypatch, capsys):
    writes = []
    mx = SimpleNamespace(get_peak_memory=lambda: 100)
    model = SimpleNamespace(
        generate=lambda **_kwargs: [SimpleNamespace(audio=[0.0, 0.1], sample_rate=24000)]
    )
    modules = {
        "mlx": SimpleNamespace(core=mx),
        "mlx.core": mx,
        "numpy": SimpleNamespace(asarray=lambda value: value, concatenate=lambda parts: parts[0]),
        "soundfile": SimpleNamespace(write=lambda *args, **kwargs: writes.append((args, kwargs))),
        "mlx_audio.tts.utils": SimpleNamespace(load_model=lambda _path: model),
    }
    for name, value in modules.items():
        monkeypatch.setitem(sys.modules, name, value)
    monkeypatch.setattr(sys, "argv", ["worker.py", "fixed-model"])
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(
            json.dumps(
                {
                    "text": "你好",
                    "language": "Chinese",
                    "reference_path": "reference.wav",
                    "reference_text": "sample",
                    "output_path": "opaque-asset-key",
                }
            )
            + "\n"
        ),
    )
    worker.run()
    assert writes[0][0][0] == "opaque-asset-key"
    assert writes[0][1] == {"format": "WAV", "subtype": "PCM_16"}
    assert json.loads(capsys.readouterr().out)["ok"] is True


@pytest.fixture
async def manager(tmp_path, monkeypatch):
    monkeypatch.setattr("app.llm.local_models.management.compatible", lambda: True)
    monkeypatch.setattr("app.llm.local_models.catalog.compatible", lambda: True)
    monkeypatch.setattr("app.llm.catalog.service.compatible", lambda: True)
    installer = Installer(tmp_path / "local-models")
    runtime = LocalRuntime(installer)
    manager = LocalModels(SessionLocal, installer, runtime)
    yield manager
    await manager.close()
    async with SessionLocal() as session:
        await session.execute(delete(LocalModelOperation))
        await session.execute(delete(LocalModelInstallation))
        await session.commit()


def action(kind, revision=0, request_id=None):
    return LocalModelActionIn(
        action=kind, expected_revision=revision, request_id=request_id or kind
    )


def test_pinned_manifest_and_credential_boundary():
    assert len(manifest()["models"]) == 2
    for model in manifest()["models"]:
        assert len(model["revision"]) == 40
        assert "speech_tokenizer/model.safetensors" in [x["path"] for x in model["files"]]
        for item in model["files"]:
            assert len(item["sha256"]) == 64
            assert model["revision"] in item["url"]
    assert credential_ready(SimpleNamespace(kind="local_qwen_tts"))
    assert not credential_ready(SimpleNamespace(kind="openai", api_key_ciphertext=""))
    with pytest.raises(ValueError):
        ProviderIn(
            expected_catalog_revision=0,
            name="local",
            kind="local_qwen_tts",
            base_url="https://wrong.invalid",
        )
    with pytest.raises(ValueError):
        SpeechSynthesisParameters(text=" ", reference_text="sample", reference_asset_id="1")


@pytest.mark.parametrize(
    "role,auth,expected",
    [
        ("admin", "session", True),
        ("admin", "session", True),
        ("user", "session", False),
        ("admin", "api_key", False),
    ],
)
def test_management_requires_platform_browser_role(role, auth, expected):
    assert can_manage_local_models(SimpleNamespace(platform_role=role, auth_kind=auth)) is expected


async def test_default_list_and_recover_never_install(manager, monkeypatch):
    async def forbidden(*_args):
        raise AssertionError("Must never download without an install action")

    monkeypatch.setattr(manager.installer, "install", forbidden)
    await manager.recover()
    assert all(item.status == "not_installed" for item in (await manager.list()).items)
    assert not manager.installer.root.exists()


async def test_install_replay_conflict_cancel_and_restart(manager, monkeypatch):
    started = asyncio.Event()

    async def install(_model, report):
        await report(23)
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(manager.installer, "install", install)
    first = await manager.action(MODEL, action("install"))
    await started.wait()
    assert first.status == "installing"
    assert (await manager.action(MODEL, action("install"))).revision == first.revision
    with pytest.raises(OperationError):
        await manager.action(MODEL, action("cancel", 1, "install"))
    with pytest.raises(RevisionConflictError):
        await manager.action(MODEL, action("cancel", 0))
    assert (await manager.action(MODEL, action("cancel", 1))).status == "cancelled"
    await manager.action(MODEL, action("install", 2, "restart"))
    await manager.close()
    await manager.recover()
    item = next(x for x in (await manager.list()).items if x.id == MODEL)
    assert item.status == "failed"


async def test_install_stop_busy_and_uninstall(manager, monkeypatch):
    async def install(model, report):
        directory = manager.installer.model_path(model["id"])
        directory.mkdir(parents=True)
        (directory / "weights").write_bytes(b"fixture")
        await report(95)

    monkeypatch.setattr(manager.installer, "install", install)
    await manager.action(MODEL, action("install"))
    await manager.jobs[MODEL]
    item = next(x for x in (await manager.list()).items if x.id == MODEL)
    assert item.status == "installed" and item.enabled
    manager.runtime.busy = True
    with pytest.raises(OperationError, match="正在生成"):
        await manager.action(MODEL, action("stop", item.revision))
    manager.runtime.busy = False
    stopped = await manager.action(MODEL, action("stop", item.revision))
    assert not stopped.enabled
    removed = await manager.action(MODEL, action("uninstall", stopped.revision))
    assert removed.status == "not_installed"
    assert not manager.installer.model_path(MODEL).exists()


async def test_uninstall_cleanup_failure_replays_failure(manager, monkeypatch):
    async with SessionLocal() as session:
        session.add(
            LocalModelInstallation(
                id=MODEL,
                status="installed",
                enabled=True,
                progress=100,
                revision=0,
            )
        )
        await session.commit()
    directory = manager.installer.model_path(MODEL)
    directory.mkdir(parents=True)
    attempts = []

    def deny(path):
        attempts.append(path)
        raise PermissionError("fixture")

    monkeypatch.setattr("app.llm.local_models.management.shutil.rmtree", deny)
    for _ in range(2):
        with pytest.raises(OperationError, match="清理模型文件失败") as caught:
            await manager.action(MODEL, action("uninstall"))
        assert caught.value.code == "cleanup_failed"
    assert attempts == [directory]
    item = next(x for x in (await manager.list()).items if x.id == MODEL)
    assert item.status == "failed" and not item.enabled and item.revision == 2


async def test_environment_retry_discards_partial_environment_only(manager, monkeypatch):
    environment = manager.installer.python.parents[2]
    partial = environment / "python" / "partial"
    partial.parent.mkdir(parents=True)
    partial.write_bytes(b"interrupted extraction")
    cached = manager.installer.root / "downloads" / "verified-archive"
    cached.parent.mkdir(parents=True)
    cached.write_bytes(b"keep resumable downloads")
    monkeypatch.setattr(
        "app.llm.local_models.installer.shutil.disk_usage",
        lambda _path: SimpleNamespace(free=100 * 1024**3),
    )

    async def fetch(*_args):
        assert not partial.exists()
        assert cached.read_bytes() == b"keep resumable downloads"
        raise ValueError("fixture download failure")

    monkeypatch.setattr("app.llm.local_models.installer.downloads.fetch_file", fetch)
    with pytest.raises(ValueError, match="fixture download failure"):
        await manager.installer.install(definition(MODEL), None)


async def test_download_resume_and_hash_rejection(tmp_path):
    data = b"known model contents"
    target = tmp_path / "weights"
    target.with_name("weights.part").write_bytes(data[:6])
    item = {
        "url": "https://files.invalid/weights",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }

    def response(request):
        assert request.headers["range"] == "bytes=6-"
        return httpx.Response(
            206, headers={"content-range": f"bytes 6-{len(data) - 1}/{len(data)}"}, content=data[6:]
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        await fetch_file(client, item, target)
    assert target.read_bytes() == data
    target.unlink()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * len(data)))
    ) as client:
        with pytest.raises(ValueError, match="SHA256"):
            await fetch_file(client, item, target)
    assert not target.exists()


async def test_runtime_serializes_and_cleans_failure(manager):
    active = 0
    maximum = 0

    async def validate():
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.01)
        active -= 1
        raise ValueError("fixture unavailable")

    results = await asyncio.gather(
        *(manager.runtime.synthesize(MODEL, {}, validate) for _ in range(3)), return_exceptions=True
    )
    assert maximum == 1
    assert all(isinstance(x, ValueError) for x in results)
    assert not manager.runtime.busy


def test_model_id_is_allowlisted():
    with pytest.raises(OperationError):
        definition("../../arbitrary")


async def test_public_api_attach_synthesis_and_uninstall(manager, monkeypatch):
    import io
    import shutil
    import wave

    from app.llm.inference.runner import InferenceRunner

    monkeypatch.setattr(app.state, "local_models", manager, raising=False)

    async def install(_model, _report):
        return

    monkeypatch.setattr(manager.installer, "install", install)

    async def infer(_model, payload, validate):
        await validate()
        shutil.copyfile(payload["reference_path"], payload["output_path"])
        return {"ok": True, "elapsed_seconds": 0.01}

    monkeypatch.setattr(manager.runtime, "synthesize", infer)
    recording = io.BytesIO()
    with wave.open(recording, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 16000 * 4)
    provider_id = None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        installed = await client.post(
            f"/v1/platform/local-models/{MODEL}/actions", json=action("install").model_dump()
        )
        assert installed.status_code == 200, installed.text
        await manager.jobs[MODEL]
        catalog = (await client.get("/v1/model-providers")).json()
        attached = await client.post(
            "/v1/local-models/attach",
            json={"model_id": MODEL, "expected_catalog_revision": catalog["revision"]},
        )
        assert attached.status_code == 200, attached.text
        provider = next(x for x in attached.json()["providers"] if x["kind"] == "local_qwen_tts")
        provider_id = provider["id"]
        assert not provider["has_api_key"]
        model_id = provider["models"][0]["id"]
        assert attached.json()["default_model_ids"] == catalog["default_model_ids"]
        repeated = await client.post(
            "/v1/local-models/attach",
            json={"model_id": MODEL, "expected_catalog_revision": attached.json()["revision"]},
        )
        assert (
            len(next(x for x in repeated.json()["providers"] if x["id"] == provider_id)["models"])
            == 1
        )
        reference = await client.post(
            "/v1/model-inference/assets",
            files={"upload": ("sample.wav", recording.getvalue(), "audio/wav")},
        )
        assert reference.status_code == 200, reference.text
        asset_id = reference.json()["id"]
        body = {
            "model_id": model_id,
            "request_id": "local-speech-test",
            "kind": "speech_synthesis",
            "asset_ids": [asset_id],
            "parameters": {
                "text": "测试语音",
                "reference_text": "参考录音",
                "reference_asset_id": asset_id,
            },
        }
        response = await client.post("/v1/model-inference/tasks", json=body)
        assert response.status_code == 200, response.text
        task = response.json()
        runner = InferenceRunner(local_runtime=manager.runtime)
        await runner.process(task["id"])
        result = (await client.get(f"/v1/model-inference/tasks/{task['id']}")).json()
        assert result["status"] == "completed", result
        assert result["log_id"]
        content = await client.get(f"/v1/model-inference/tasks/{task['id']}/content")
        assert content.content.startswith(b"RIFF")
        replay = await client.post("/v1/model-inference/tasks", json=body)
        assert replay.json()["id"] == task["id"]
        await client.delete(
            f"/v1/model-inference/tasks/{task['id']}",
            params={"expected_revision": result["revision"]},
        )
        state = next(x for x in (await manager.list()).items if x.id == MODEL)
        await manager.action(MODEL, action("uninstall", state.revision))
        assert model_id not in [
            x["id"] for x in (await client.get("/v1/model-inference/options")).json()["items"]
        ]
        revision = (await client.get("/v1/model-providers")).json()["revision"]
        await client.delete(
            f"/v1/model-providers/{provider_id}", params={"expected_catalog_revision": revision}
        )


async def test_unsupported_and_insufficient_space_do_not_download(manager, monkeypatch):
    monkeypatch.setattr("app.llm.local_models.management.compatible", lambda: False)
    with pytest.raises(OperationError, match="Apple Silicon"):
        await manager.action(MODEL, action("install"))
    assert not manager.installer.root.exists()
    monkeypatch.setattr(
        "app.llm.local_models.installer.shutil.disk_usage", lambda _: SimpleNamespace(free=0)
    )

    async def report(_progress):
        raise AssertionError("no download progress is possible")

    with pytest.raises(ValueError, match="磁盘空间不足"):
        await manager.installer.install(definition(MODEL), report)


async def test_worker_switch_idle_and_inference_serialization(manager, monkeypatch):
    import json

    workers = []
    concurrent = 0
    maximum = 0

    class Pipe:
        def write(self, _data):
            pass

        async def drain(self):
            pass

    class Reader:
        async def readline(self):
            nonlocal concurrent, maximum
            concurrent += 1
            maximum = max(maximum, concurrent)
            await asyncio.sleep(0.01)
            concurrent -= 1
            return json.dumps({"ok": True}).encode() + b"\n"

    class ErrorReader:
        async def read(self, _size):
            return b""

    class Process:
        def __init__(self):
            self.returncode = None
            self.stdin, self.stdout, self.stderr = Pipe(), Reader(), ErrorReader()

        def terminate(self):
            self.returncode = 0

        def kill(self):
            self.returncode = 0

        async def wait(self):
            return self.returncode

    async def spawn(*_args, **_kwargs):
        worker = Process()
        workers.append(worker)
        return worker

    async def validate():
        return

    monkeypatch.setattr("app.llm.local_models.runtime.asyncio.create_subprocess_exec", spawn)
    runtime = manager.runtime
    runtime.idle_seconds = 0.05
    await asyncio.gather(
        runtime.synthesize(MODEL, {}, validate), runtime.synthesize(MODEL, {}, validate)
    )
    assert maximum == 1 and len(workers) == 1
    await runtime.synthesize("qwen3-tts-1.7b-base", {}, validate)
    assert len(workers) == 2 and workers[0].returncode == 0
    await asyncio.sleep(0.1)
    assert workers[1].returncode == 0 and runtime.process is None and not runtime.busy
