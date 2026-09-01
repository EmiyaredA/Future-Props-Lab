from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from pathlib import Path
from typing import Any

import httpx

try:
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from management_api import management_api_key

REPO_ROOT = Path(__file__).resolve().parents[3]
EXPORT_WORKFLOW_VERSION = "v15r1"
FRAGMENT_ID = "runaway-full"
FULL_DURATION_MS = 1_780_344
SAMPLE_DURATION_MS = 180_000
Q_OPENING_EXPORT = ("boundary-full-cast-and-q-opening", 0, 30_000)
EXPORTS = (
    ("user-clip-suzuha-lab-entrance", 648_000, 670_000),
    ("cg-kagari-hououin-imitation", 588_000, 620_000),
    ("cg-mother-identity-stop", 786_000, 802_000),
    ("cg-cleaning-sergeant", 1_232_000, 1_243_000),
    ("cg-group-rebukes-kagari", 1_453_000, 1_464_000),
    ("cg-kagari-remembers-mother", 1_561_000, 1_572_000),
    ("cg-harem-chaos-finale", 1_760_000, 1_780_344),
)
BOUNDARY_EXPORTS = (
    ("boundary-phone-ui", 65_000, 82_000),
    ("boundary-okabe-rap", 233_000, 250_000),
    ("boundary-rooftop-transition", 360_000, 401_000),
    ("boundary-return-lab", 438_000, 465_000),
    ("boundary-imitation-lab", 588_000, 620_000),
    ("boundary-suzuha-lab-entrance", 648_000, 670_000),
    ("boundary-late-rooftop-switch", 1_598_000, 1_640_000),
    ("boundary-time-machine-leap", 1_650_000, 1_685_000),
    ("boundary-final-rooftop-cg", 1_758_000, 1_780_344),
)
PREVIEW_REGRESSION_EXPORTS = (
    ("diagnostic-two-actors-47s-52s", 47_000, 52_000),
    ("diagnostic-phone-dialogue-65s-82s", 65_000, 82_000),
    ("diagnostic-long-subtitle-168s-173s", 168_000, 173_000),
    ("diagnostic-cg-entry-338s-347s", 338_000, 347_000),
    ("diagnostic-no-duplicate-1518s-1527s", 1_518_000, 1_527_000),
    ("diagnostic-finale-cg-1761s-1780s", 1_761_000, 1_780_344),
)
LATEST_REVISION_EXPORTS = (
    ("diagnostic-kurisu-shy-118s-126s", 118_000, 126_000),
    ("diagnostic-pair-shy-219s-233s", 219_000, 233_000),
    ("diagnostic-explanation-card-680s-694s", 680_000, 694_000),
    ("diagnostic-finale-moeka-v9", 1_761_000, 1_780_344),
)
LATEST_FIX_EXPORTS = (
    ("diagnostic-overlap-fix-1518s-1527s", 1_518_000, 1_527_000),
    ("diagnostic-ending-thanks-1768s-1780s", 1_768_000, 1_780_344),
)
EXPRESSION_SYNC_EXPORTS = (
    ("diagnostic-expression-sync-151s-161s", 151_000, 161_000),
    ("diagnostic-mother-identity-v4-786s-802s", 786_000, 802_000),
    ("diagnostic-luka-speaker-1649s-1656s", 1_649_000, 1_656_000),
)
SPEAKER_FIX_EXPORTS = (("diagnostic-luka-speaker-fix-526s-539s", 526_000, 539_000),)
SCENE_TIME_EXPORTS = (
    ("scene-main-day-switch-145s-160s", 145_000, 160_000),
    ("scene-day-to-evening-964s-980s", 964_000, 980_000),
    ("scene-evening-main-1182s-1198s", 1_182_000, 1_198_000),
    ("scene-evening-to-night-1294s-1310s", 1_294_000, 1_310_000),
)
PORTRAIT_REVIEW_EXPORTS = (
    ("portrait-faris-private-38s-43s", 38_000, 43_000),
    ("portrait-kurisu-mayuri-shy-219s-233s", 219_000, 233_000),
    ("portrait-luka-private-283s-291s", 283_000, 291_000),
    ("portrait-moeka-299s-309s", 299_000, 309_000),
    ("portrait-suzuha-kagari-1353s-1362s", 1_353_000, 1_362_000),
    ("portrait-maho-suzuha-1596s-1612s", 1_596_000, 1_612_000),
)
FINAL_CG_REVIEW_EXPORTS = (
    ("final-cg-01-cleaning-night", 1_312_000, 1_322_000),
    ("final-cg-02-rooftop-finale", 1_760_000, 1_780_344),
    ("final-cg-03-kagari-imitation", 590_000, 620_000),
    ("final-cg-04-suzuha-entrance", 656_000, 671_000),
    ("final-cg-05-kagari-remembers", 1_559_000, 1_573_000),
    ("final-cg-06-storytime", 1_094_000, 1_107_000),
    ("final-cg-07-cleaning-evening", 1_231_000, 1_244_000),
    ("final-cg-08-kagari-rejects", 1_440_000, 1_452_000),
    ("final-cg-09-suzuha-maho", 1_606_000, 1_614_000),
    ("final-cg-10-time-machine", 1_664_000, 1_680_000),
    ("final-cg-11a-lab-reaction", 834_000, 842_000),
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
    if only == "q-opening":
        return [Q_OPENING_EXPORT]
    if only == "preview-regression":
        return [*PREVIEW_REGRESSION_EXPORTS]
    if only == "latest-review":
        return [*LATEST_REVISION_EXPORTS]
    if only == "latest-fixes":
        return [*LATEST_FIX_EXPORTS]
    if only == "expression-sync":
        return [*EXPRESSION_SYNC_EXPORTS]
    if only == "speaker-fix":
        return [*SPEAKER_FIX_EXPORTS]
    if only == "scene-time":
        return [*SCENE_TIME_EXPORTS]
    if only == "portrait-review":
        return [*PORTRAIT_REVIEW_EXPORTS]
    if only == "final-cgs":
        return [*FINAL_CG_REVIEW_EXPORTS]
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
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"API {method} {path} 返回 {response.status_code}: {response.text}"
        ) from exc
    return response.json()


def export_path(project_id: str, suffix: str = "") -> str:
    return f"/v1/galgame-workshop/projects/{project_id}/video-exports{suffix}"


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
    project_id: str,
    only: str | None = None,
    rng: random.Random | None = None,
) -> tuple[int, dict[str, str]]:
    story = request_json(
        client,
        "GET",
        f"/v1/galgame-workshop/projects/{project_id}/story",
    )
    revision = int(story["revision"])
    requested = requested_exports(only, rng)
    task_names: dict[str, str] = {}
    for item in requested:
        name = item[0] if item else "full-29m40s344-v15"
        body = request_body(revision, item)
        preview = request_json(client, "POST", export_path(project_id, "/preview"), body)
        if not preview["ready"]:
            raise RuntimeError(f"导出预览未通过 {name}: {preview}")
        created = request_json(
            client,
            "POST",
            export_path(project_id),
            {
                **body,
                "requestId": (
                    f"runaway-r{revision}-{EXPORT_WORKFLOW_VERSION}-{name[:28]}-"
                    f"{hashlib.sha256(name.encode()).hexdigest()[:8]}"
                ),
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


def wait_and_download(
    client: httpx.Client,
    project_id: str,
    revision: int,
    task_names: dict[str, str],
) -> None:
    output_dir = REPO_ROOT / ".runtime" / "galgame-exports" / f"rev{revision}"
    output_dir.mkdir(parents=True, exist_ok=True)
    pending = set(task_names)
    last_states: dict[str, tuple[str, str, int]] = {}
    while pending:
        for task_id in list(pending):
            task = request_json(client, "GET", export_path(project_id, f"/{task_id}"))
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
                response = client.get(export_path(project_id, f"/{task_id}/download"))
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
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument(
        "--only",
        choices=(
            "random-sample",
            "user-clip",
            "cg-clips",
            "boundary-clips",
            "q-opening",
            "preview-regression",
            "latest-review",
            "latest-fixes",
            "expression-sync",
            "speaker-fix",
            "scene-time",
            "portrait-review",
            "final-cgs",
            "full",
        ),
    )
    parser.add_argument("--seed", type=int, help="固定随机样片位置，便于复现")
    args = parser.parse_args()
    management_key = management_api_key()
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        rng = random.Random(args.seed) if args.seed is not None else None
        revision, tasks = submit(client, args.project_id, args.only, rng)
        if args.action == "all":
            wait_and_download(client, args.project_id, revision, tasks)


if __name__ == "__main__":
    main()
