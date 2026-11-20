"""Official ZONOS3 MLX Engine/Scheduler behind FPL's private line protocol."""

import contextlib
import json
import resource
import sys
import time
import traceback
from pathlib import Path

LANGUAGES = {"Chinese": "cmn", "English": "en_us", "Japanese": "ja"}
EMOTIONS = {"happy": 3.0, "angry": 3.0, "sad": 6.0, "serene": 4.0, "scared": 8.0, "confused": 2.0}


def run():
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        import numpy as np
        import soundfile as sf
        import torch
        from zonos3.tokenizer.textnorm import load_normalizer
        from zonos3.tts.plan import Speaker
        from zonos3_mlx.audio_io import decode_pcm
        from zonos3_mlx.engine import Engine
        from zonos3_mlx.scheduler import Scheduler

        root = Path(sys.argv[-1]) / "gguf"
        engine = Engine.load(
            root / "backbone-ptq.gguf",
            zac=[str(root / "zac-keep2.gguf")],
            normalizer=load_normalizer(),
        )
        if (
            not engine.has_reference_encoder
            or engine.speaker_encoder is None
            or engine.steer_bundle is None
        ):
            raise ValueError("Missing cloning or steering companions")
    if "--check" in sys.argv:
        return
    scheduler = Scheduler(engine, batch=2)
    scheduler.start(warmup=False)
    try:
        for line in sys.stdin:
            try:
                body = json.loads(line)
                started = time.monotonic()
                with contextlib.redirect_stdout(sys.stderr):
                    scheduler.submit(mx.reset_peak_memory).result()
                    pcm = decode_pcm(Path(body["reference_path"]).read_bytes(), max_seconds=30)
                    mode = body.get("clone_mode", "embedding")
                    if mode == "reference":
                        codes = scheduler.submit(
                            lambda pcm=pcm: engine.reference_encoder().encode(pcm, max_seconds=30)
                        ).result()
                        speaker = Speaker(
                            mode,
                            reference_codes=torch.from_numpy(np.asarray(codes, dtype=np.int32)),
                        )
                    elif mode == "embedding":
                        embedding = scheduler.submit(engine.speaker_encoder.embed, pcm).result()
                        speaker = Speaker(mode, embedding=torch.from_numpy(embedding))
                    else:
                        raise ValueError("Unsupported cloning mode")
                    emotion = body.get("emotion", "neutral")
                    controls = (
                        None
                        if emotion == "neutral"
                        else {
                            "emotions." + emotion: EMOTIONS[emotion]
                            * body.get("emotion_strength", 0.5)
                        }
                    )
                    request = dict(
                        text=body["text"],
                        language=LANGUAGES[body["language"]],
                        speaker_mode=mode,
                        seed=body.get("seed", 42),
                        controls=controls,
                    )
                    result = scheduler.synthesize(request, speaker=speaker)
                    rate = engine.decoder.sample_rate
                    sf.write(body["output_path"], result.pcm, rate, format="WAV", subtype="PCM_16")
                    metrics = dict(
                        ok=True,
                        sample_rate=rate,
                        duration_seconds=len(result.pcm) / rate,
                        elapsed_seconds=time.monotonic() - started,
                        peak_memory_bytes=scheduler.submit(mx.get_peak_memory).result(),
                        process_peak_memory_bytes=resource.getrusage(
                            resource.RUSAGE_SELF
                        ).ru_maxrss,
                        seed=result.seed,
                        clone_mode=mode,
                        emotion=emotion,
                        controls=controls,
                    )
            except Exception:
                traceback.print_exc(file=sys.stderr)
                metrics = {
                    "ok": False,
                    "message": "ZONOS3 合成失败，请检查参考录音、情绪设置或可用内存",
                }
            print(json.dumps(metrics), flush=True)
    finally:
        scheduler.stop()


if __name__ == "__main__":
    run()
