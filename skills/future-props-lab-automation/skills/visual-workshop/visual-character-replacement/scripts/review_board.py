"""Initialize, inspect, render and merge a local supervision board (stdlib only)."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from board_text import make_texts
from production_record import (
    GATES,
    LABELS,
    RecordError,
    adopted_candidate,
    candidate_status,
    digest,
    final_hash,
    fingerprints,
    gate_hash,
    gate_status,
    merge_feedback,
    now,
    reconcile,
    subject_hash,
    user_decision,
    validate,
)

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "assets" / "templates"


def load(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RecordError(f"JSON 键重复：{key}")
            result[key] = value
        return result

    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs)


def write_json(path, value, overwrite=False):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w" if overwrite else "x", encoding="utf-8") as file:
        file.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def view_record(record):
    view = copy.deepcopy(record)
    for source, shot in zip(record["shots"], view["shots"], strict=True):
        shot["adopted_candidate_id"] = (adopted_candidate(record, source) or {}).get("id")
        for original, candidate in zip(source["candidates"], shot["candidates"], strict=True):
            candidate["subject_hash"] = subject_hash(record, source, original)
            candidate["agent_status"] = candidate_status(record, source, original)
            candidate["user_status"] = user_decision(record, source, original)
            for check in candidate["checks"]:
                check["status"] = (
                    check["verdict"]
                    if check["subject_hash"] == candidate["subject_hash"]
                    else "stale"
                )
    view["gate_views"] = {
        g: {"subject_hash": gate_hash(record, g), "status": gate_status(record, g)} for g in GATES
    }
    view["snapshot_hash"] = digest(record)
    view["snapshot_at"] = now()
    view["labels"] = LABELS
    if view["final"]["candidate"]:
        for check in view["final"]["candidate"]["checks"]:
            check["status"] = (
                check["verdict"] if check["subject_hash"] == final_hash(record) else "stale"
            )
    return view


def local_media(record, record_dir):
    """Prepare copies without exposing absolute paths or fetching remote media."""
    view = view_record(record)
    prepared = {}

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            if value.get("kind") in ("image", "video", "audio") and "path" in value:
                relative = value["path"]
                source = (record_dir / relative).resolve()
                if not source.is_relative_to(record_dir.resolve()):
                    raise RecordError("媒体路径通过符号链接越界")
                if not source.is_file():
                    value["missing"] = True
                    value.pop("path")
                    return
                suffix = source.suffix.lower()
                allowed = {
                    "image": {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"},
                    "video": {".mp4", ".webm", ".mov"},
                    "audio": {".mp3", ".wav", ".m4a", ".ogg"},
                }
                if suffix not in allowed[value["kind"]]:
                    raise RecordError("媒体扩展名与类型不匹配")
                hasher = hashlib.sha256()
                with source.open("rb") as file:
                    for chunk in iter(lambda: file.read(1024 * 1024), b""):
                        hasher.update(chunk)
                sha = hasher.hexdigest()
                if value.get("sha256") != sha:
                    raise RecordError("媒体内容与记录 SHA256 不一致，请更新记录并重新 review")
                name = f"media/{sha}{suffix}"
                prepared[name] = source
                value["path"] = name
                value["missing"] = False
            else:
                for child in value.values():
                    walk(child)

    # Only declared media slots are portable assets. Input snapshots may contain
    # similarly named keys describing App inputs, which must stay untouched.
    walk(view["source"].get("media"))
    for entity in view["characters"] + view["scenes"]:
        walk(entity["references"])
    for shot in view["shots"]:
        walk(shot["source_media"])
        for reference in shot["references"]:
            walk(reference.get("media"))
        for candidate in shot["candidates"]:
            walk(candidate.get("media"))
    if view["final"]["candidate"]:
        walk(view["final"]["candidate"].get("media"))
    return view, prepared


def render(record, input_path, output_dir, overwrite=False):
    validate(record)
    destination = Path(output_dir)
    if destination.exists() and any(destination.iterdir()) and not overwrite:
        raise RecordError("预览目录非空；重生成请显式使用 --overwrite")
    if destination.resolve() == Path(input_path).resolve().parent:
        raise RecordError("预览目录不能是制作记录目录")
    view, prepared = local_media(record, Path(input_path).resolve().parent)
    texts = make_texts(record, TEMPLATES)
    data = (
        json.dumps(view, ensure_ascii=False, allow_nan=False)
        .replace("<", "\\u003c")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    html = (TEMPLATES / "board.html").read_text(encoding="utf-8")
    html = html.replace("/* BOARD_CSS */", (TEMPLATES / "board.css").read_text(encoding="utf-8"))
    html = html.replace("/* BOARD_JS */", (TEMPLATES / "board.js").read_text(encoding="utf-8"))
    html = html.replace("<!-- BOARD_DATA -->", data)
    destination.mkdir(parents=True, exist_ok=True)
    for name, source in prepared.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (destination / "index.html").write_text(html, encoding="utf-8")
    for name, content in texts.items():
        (destination / f"{name}.md").write_text(content, encoding="utf-8")
    return {
        "html": str((destination / "index.html").resolve()),
        "text_boards": list(texts),
        "snapshot_hash": digest(record),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--title", required=True)
    init.add_argument("--demo", action="store_true")
    init.add_argument("--output", required=True)
    init.add_argument("--overwrite", action="store_true")
    for command in ("validate", "fingerprint", "render", "reconcile", "merge-feedback"):
        child = sub.add_parser(command)
        child.add_argument("--input", required=True)
        if command == "render":
            child.add_argument("--output-dir", required=True)
            child.add_argument("--overwrite", action="store_true")
        elif command in ("reconcile", "merge-feedback"):
            child.add_argument("--output", required=True)
            child.add_argument("--overwrite", action="store_true")
        if command == "reconcile":
            child.add_argument("--expected-revision", required=True, type=int)
        if command == "merge-feedback":
            child.add_argument("--feedback", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            record = load(TEMPLATES / ("demo.json" if args.demo else "record.json"))
            record.update(record_id=str(uuid4()), title=args.title, updated_at=now())
            if args.demo:
                for shot in record["shots"]:
                    for candidate in shot["candidates"]:
                        for check in candidate["checks"]:
                            check["subject_hash"] = subject_hash(record, shot, candidate)
            validate(record)
            write_json(args.output, record, args.overwrite)
            result = {"record": args.output, "demo": record["demo"]}
        else:
            record = validate(load(args.input))
            if args.command == "validate":
                result = {
                    "valid": True,
                    "shots": len(record["shots"]),
                    "revision": record["revision"],
                }
            elif args.command == "fingerprint":
                result = {
                    "snapshot_hash": digest(record),
                    "candidates": {s["id"]: fingerprints(record, s) for s in record["shots"]},
                    "gates": {g: gate_hash(record, g) for g in GATES},
                    "final_checks": final_hash(record),
                }
            elif args.command == "render":
                result = render(record, args.input, args.output_dir, args.overwrite)
            else:
                if args.command == "reconcile":
                    if args.expected_revision != record["revision"]:
                        raise RecordError("expected-revision 与当前记录不符")
                    result = reconcile(record)
                else:
                    result = merge_feedback(record, load(args.feedback))
                write_json(args.output, result, args.overwrite)
                result = {"record": args.output, "revision": result["revision"]}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (RecordError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"review-board: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
