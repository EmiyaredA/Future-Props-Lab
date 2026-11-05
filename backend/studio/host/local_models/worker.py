"""Standalone private pipe worker. Does not import the application or its database."""

import contextlib
import json
import resource
import sys
import time


def run():
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        import numpy as np
        import soundfile as sf
        from mlx_audio.tts.utils import load_model

        model = load_model(sys.argv[-1])
    if "--check" in sys.argv:
        return
    for line in sys.stdin:
        try:
            body = json.loads(line)
            started = time.monotonic()
            with contextlib.redirect_stdout(sys.stderr):
                pieces = list(
                    model.generate(
                        text=body["text"],
                        lang_code=body["language"],
                        ref_audio=body["reference_path"],
                        ref_text=body["reference_text"],
                    )
                )
                if not pieces:
                    raise ValueError("empty output")
                audio = np.concatenate([np.asarray(item.audio) for item in pieces])
                rate = pieces[0].sample_rate
                sf.write(body["output_path"], audio, rate, format="WAV", subtype="PCM_16")
            result = {
                "ok": True,
                "sample_rate": rate,
                "duration_seconds": len(audio) / rate,
                "elapsed_seconds": time.monotonic() - started,
                "peak_memory_bytes": mx.get_peak_memory(),
                "process_peak_memory_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            }
        except Exception:
            result = {"ok": False, "message": "语音合成失败，请检查参考录音或可用内存"}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    run()
