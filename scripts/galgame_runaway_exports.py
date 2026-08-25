from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ID = "63ac832d-bff3-4053-9c9f-f55c9dafc52a"
FRAGMENT_ID = "runaway-full"
FULL_DURATION_MS = 1_780_344
SAMPLE_DURATION_MS = 180_000
EXPORTS = (
    ("user-clip-10m57s-12m29s500", 657_000, 749_500),
    ("cg-kagari-hououin-imitation", 593_385, 623_296),
    ("cg-mother-identity-stop", 780_228, 806_772),
    ("cg-cleaning-sergeant", 1_233_804, 1_254_683),
    ("cg-harem-chaos-finale", 1_735_012, 1_764_737),
)
BOUNDARY_EXPORTS = (
    ("boundary-rooftop-06m13", 368_000, 380_000),
    ("boundary-imitation-09m53", 589_000, 604_000),
    ("boundary-two-machines-10m53", 649_000, 660_000),
    ("boundary-return-lab-11m27", 682_000, 693_000),
    ("boundary-farewell-return-28m00", 1_676_000, 1_688_000),
)


def random_sample(rng: random.Random | None = None) -> tuple[str, int, int]:
    source = rng or random.SystemRandom()
    latest_start = FULL_DURATION_MS - SAMPLE_DURATION_MS
    start_ms = source.randrange(0, latest_start + 1) // 1_000 * 1_000
    end_ms = start_ms + SAMPLE_DURATION_MS
    return (f"random-3m-{start_ms:07d}-{end_ms:07d}", start_ms, end_ms)


def requested_exports(
    only: str | None,
    rng: random.Random | None = None,
) -> list[tuple[str, int, int] | None]:
    if only == "user-clip":
        return [EXPORTS[0]]
    if only == "cg-clips":
        return [*EXPORTS[1:]]
    if only == "boundary-clips":
        return [*BOUNDARY_EXPORTS]
    if only == "full":
        return [None]
    return [random_sample(rng)]


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = client.request(method, path, json=payload)
    response.raise_for_status()
    return response.json()


def export_path(suffix: str = "") -> str:
    return f"/v1/galgame-workshop/projects/{PROJECT_ID}/video-exports{suffix}"


def request_body(revision: int, item: tuple[str, int, int] | None) -> dict[str, Any]:
    common = {
        "expectedStoryRevision": revision,
        "locale": "zh",
        "preset": "1080p30",
        "branchSelections": [],
        "captureFrame": {"x": 0, "y": 0, "width": 1920, "height": 1080},
    }
    if item is None:
        return {**common, "scope": "route", "fragmentIds": []}
    _name, start_ms, end_ms = item
    return {
        **common,
        "scope": "clip",
        "fragmentIds": [],
        "clipRange": {
            "fragmentId": FRAGMENT_ID,
            "startMs": start_ms,
            "endMs": end_ms,
        },
    }


def submit(
    client: httpx.Client,
    only: str | None = None,
    rng: random.Random | None = None,
) -> tuple[int, dict[str, str]]:
    story = request_json(
        client,
        "GET",
        f"/v1/galgame-workshop/projects/{PROJECT_ID}/story",
    )
    revision = int(story["revision"])
    requested = requested_exports(only, rng)
    task_names: dict[str, str] = {}
    for item in requested:
        name = item[0] if item else "full-29m40s344"
        body = request_body(revision, item)
        preview = request_json(client, "POST", export_path("/preview"), body)
        if not preview["ready"]:
            raise RuntimeError(f"导出预览未通过 {name}: {preview}")
        created = request_json(
            client,
            "POST",
            export_path(),
            {
                **body,
                "requestId": f"runaway-rev{revision}-{name}",
                "previewFingerprint": preview["previewFingerprint"],
            },
        )
        task_names[created["id"]] = name
        print(
            json.dumps(
                {
                    "submitted": name,
                    "taskId": created["id"],
                    "durationMs": preview["route"]["estimatedDurationMs"],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
    return revision, task_names


def wait_and_download(client: httpx.Client, revision: int, task_names: dict[str, str]) -> None:
    output_dir = REPO_ROOT / ".runtime" / "galgame-exports" / f"rev{revision}"
    output_dir.mkdir(parents=True, exist_ok=True)
    pending = set(task_names)
    last_states: dict[str, tuple[str, str, int]] = {}
    while pending:
        for task_id in list(pending):
            task = request_json(client, "GET", export_path(f"/{task_id}"))
            state = (task["status"], task["phase"], task["progress"])
            if last_states.get(task_id) != state:
                print(
                    json.dumps(
                        {
                            "name": task_names[task_id],
                            "status": state[0],
                            "phase": state[1],
                            "progress": state[2],
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                last_states[task_id] = state
            if task["status"] in {"failed", "cancelled"}:
                raise RuntimeError(f"导出失败 {task_names[task_id]}: {task.get('error')}")
            if task["status"] == "completed":
                response = client.get(export_path(f"/{task_id}/download"))
                response.raise_for_status()
                target = output_dir / f"{task_names[task_id]}.mp4"
                target.write_bytes(response.content)
                print(
                    json.dumps(
                        {"downloaded": str(target), "bytes": target.stat().st_size},
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                pending.remove(task_id)
        if pending:
            time.sleep(10)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="默认随机抽取并下载《自由粒子的离家出走》连续三分钟验收视频"
    )
    parser.add_argument("action", choices=("all", "submit"), default="all", nargs="?")
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument(
        "--only",
        choices=("random-sample", "user-clip", "cg-clips", "boundary-clips", "full"),
    )
    parser.add_argument("--seed", type=int, help="固定随机样片位置，便于复现")
    args = parser.parse_args()
    management_key = (
        dotenv_values(REPO_ROOT / "backend" / ".env").get("FPL_MANAGEMENT_API_KEY") or ""
    ).strip()
    if not management_key.startswith("fpm_"):
        raise RuntimeError("backend/.env 未配置可用的 FPL_MANAGEMENT_API_KEY")
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        rng = random.Random(args.seed) if args.seed is not None else None
        revision, tasks = submit(client, args.only, rng)
        if args.action == "all":
            wait_and_download(client, revision, tasks)


if __name__ == "__main__":
    main()
