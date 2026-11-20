"""Per-provider parameter and private-worker boundaries without model downloads."""

import asyncio
import hashlib
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from studio.apps.model_service.inference.catalog import normalize_parameters
from studio.apps.model_service.providers.local_qwen import speech_parameters
from studio.config.local_models import ZONOS_MODEL_ID, definition, required_disk_bytes
from studio.contracts.model_service.model_native import SpeechRequest, valid_synthesis_metrics
from studio.host.local_models.installer import Installer
from studio.host.local_models.zonos_install import environment_ready, environment_stamp


def normalize(kind, **params):
    return normalize_parameters(
        SimpleNamespace(
            kind="speech_synthesis",
            asset_ids=["ref"],
            parameters={
                "text": "助手じゃない。",
                "language": "Japanese",
                "reference_asset_id": "ref",
                **params,
            },
        ),
        None,
        SimpleNamespace(kind=kind),
        [SimpleNamespace(media_kind="audio")],
    )


def test_zonos_no_transcript_and_qwen_still_requires_it():
    values = normalize("local_zonos_tts")
    assert values["reference_text"] == "" and values["seed"] == 42
    assert values["clone_mode"] == "embedding" and values["emotion"] == "neutral"
    with pytest.raises(ValidationError):
        normalize("local_qwen_tts")
    with pytest.raises(ValidationError):
        normalize("local_qwen_tts", reference_text=" ")
    with pytest.raises(ValidationError):
        normalize("local_qwen_tts", reference_text="录音", emotion="happy")
    assert speech_parameters("local_zonos_tts")["reference_text_required"] is False
    assert speech_parameters()["reference_text_required"] is True


@pytest.mark.parametrize(
    "params",
    [
        {"clone_mode": "arbitrary"},
        {"emotion": "custom prompt"},
        {"emotion_strength": 1.01},
        {"emotion_strength": float("nan")},
        {"seed": -1},
        {"seed": 2**32},
        {"language": "unknown"},
        {"text": " "},
        {"controls": {"identity.age": 100}},
    ],
)
def test_zonos_rejects_unsupported_and_unbounded_parameters(params):
    with pytest.raises(ValidationError):
        normalize("local_zonos_tts", **params)


def test_private_request_revalidates_model_options():
    base = dict(
        model_id=ZONOS_MODEL_ID,
        task_id="task",
        text="Hello",
        language="English",
        reference_asset_id="ref",
        reference_filename="reference.wav",
        reference_byte_size=100,
        reference_sha256="a" * 64,
    )
    request = SpeechRequest(**base, synthesis_options={"emotion": "angry", "seed": 123})
    assert request.parameters()["emotion"] == "angry"
    for overrides in (
        {"synthesis_options": {"text": "override"}},
        {"synthesis_options": {"emotion_strength": 99}},
        {"model_id": "qwen3-tts-0.6b-base"},
        {"model_id": "ffmpeg-video-sharpen"},
    ):
        with pytest.raises(ValidationError):
            SpeechRequest(**{**base, **overrides})


def test_zonos_environment_isolated_and_marker_tracks_source_and_lock(tmp_path):
    installer = Installer(tmp_path)
    model = definition(ZONOS_MODEL_ID)
    assert installer.python_for(ZONOS_MODEL_ID) != installer.python
    assert not environment_ready(installer, model)
    executable = installer.python_for(ZONOS_MODEL_ID)
    executable.parent.mkdir(parents=True)
    executable.touch()
    marker = installer.environment_path(ZONOS_MODEL_ID) / "ready"
    marker.write_text("1")
    assert not environment_ready(installer, model)
    marker.write_text(environment_stamp(model))
    assert environment_ready(installer, model)
    assert required_disk_bytes(model) > sum(part["size"] for part in model["files"]) * 2


def test_metrics_are_bounded_and_cannot_claim_other_cloning_controls():
    options = dict(clone_mode="reference", emotion="serene", seed=42)
    metrics = dict(
        ok=True,
        elapsed_seconds=1.0,
        clone_mode="reference",
        emotion="serene",
        seed=42,
        controls={"emotions.serene": 3.0},
    )
    assert valid_synthesis_metrics(ZONOS_MODEL_ID, options, metrics)
    assert not valid_synthesis_metrics("qwen3-tts-0.6b-base", {}, metrics)
    for overrides in (
        {"seed": 7},
        {"controls": {"identity.age": 1}},
        {"controls": {"emotions.serene": float("nan")}},
        {"elapsed_seconds": -1},
        {"unbounded": "data"},
    ):
        assert not valid_synthesis_metrics(ZONOS_MODEL_ID, options, {**metrics, **overrides})


@pytest.mark.parametrize("failure", [ValueError, asyncio.CancelledError])
async def test_failed_or_cancelled_zonos_repair_restores_its_environment_and_keeps_qwen(
    tmp_path, monkeypatch, failure
):
    from studio.host.local_models import zonos_install

    installer = Installer(tmp_path)
    model = dict(definition(ZONOS_MODEL_ID))
    content = b"synthetic verified weight"
    model["files"] = [
        {
            "path": "gguf/backbone-ptq.gguf",
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    ]
    weight = installer.model_path(ZONOS_MODEL_ID) / model["files"][0]["path"]
    weight.parent.mkdir(parents=True)
    weight.write_bytes(content)
    environment = installer.environment_path(ZONOS_MODEL_ID)
    executable = installer.python_for(ZONOS_MODEL_ID)
    executable.parent.mkdir(parents=True)
    executable.write_text("original interpreter")
    (environment / "ready").write_text(environment_stamp(model))
    installer.python.parent.mkdir(parents=True)
    installer.python.write_text("existing Qwen interpreter")
    monkeypatch.setattr(
        zonos_install.shutil, "disk_usage", lambda _path: SimpleNamespace(free=100 * 1024**3)
    )

    async def interrupted(_installer, _model, _client):
        environment.mkdir(parents=True)
        (environment / "partial").write_text("unfinished replacement")
        raise failure("synthetic interruption")

    async def report(_progress):
        pytest.fail("failed repair must not report completion")

    monkeypatch.setattr(zonos_install, "prepare_environment", interrupted)
    with pytest.raises(failure):
        await zonos_install.install(installer, model, report, repair=True)
    assert executable.read_text() == "original interpreter"
    assert environment_ready(installer, model)
    assert installer.python.read_text() == "existing Qwen interpreter"
    assert weight.read_bytes() == content
