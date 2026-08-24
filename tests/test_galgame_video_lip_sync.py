import math
import wave
from pathlib import Path

from app.galgame_workshop.video_lip_sync import (
    HOP_US,
    analyze_audio_envelope,
    prepare_audio_envelopes,
)


def _write_levels(path: Path, amplitudes: list[float]) -> None:
    sample_rate = 48_000
    samples_per_hop = round(sample_rate * HOP_US / 1_000_000)
    payload = bytearray()
    for amplitude in amplitudes:
        for index in range(samples_per_hop):
            value = amplitude * math.sin(index / sample_rate * 2 * math.pi * 440)
            integer = max(-32768, min(32767, round(value * 32767)))
            payload.extend(integer.to_bytes(2, "little", signed=True))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(payload)


def test_audio_envelope_reports_silence_half_and_loud_levels(tmp_path: Path) -> None:
    audio = tmp_path / "levels.wav"
    _write_levels(audio, [0, 0.01, 0.1])
    envelope = analyze_audio_envelope(audio)
    assert len(envelope.levels_db) == 3
    assert envelope.levels_db[0] <= -99
    assert -46 < envelope.levels_db[1] < -40
    assert -26 < envelope.levels_db[2] < -20


def test_audio_envelope_cache_is_reused(tmp_path: Path, monkeypatch) -> None:
    audio = tmp_path / "master.wav"
    _write_levels(audio, [0.02, 0.04])
    document = {
        "assets": [{"id": "master", "fileId": "file-master"}],
        "chapters": [
            {
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"masterAudio": {"assetId": "master"}},
                        "blocks": [],
                    }
                ]
            }
        ],
    }
    cache = tmp_path / "cache"
    first = prepare_audio_envelopes(
        document,
        {"file-master": audio},
        cache_dir=cache,
        asset_fingerprints={"file-master": "fixed"},
        selected_fragment_ids={"main"},
    )
    monkeypatch.setattr(
        "app.galgame_workshop.video_lip_sync.analyze_audio_envelope",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("cache miss")),
    )
    second = prepare_audio_envelopes(
        document,
        {"file-master": audio},
        cache_dir=cache,
        asset_fingerprints={"file-master": "fixed"},
        selected_fragment_ids={"main"},
    )
    assert second == first
