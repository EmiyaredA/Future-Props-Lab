"""Versioned local production records; no App or model calls."""

from __future__ import annotations

import copy
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import PurePosixPath, PureWindowsPath

DIMENSIONS = ("technical", "static", "dynamic", "audio")
VERDICTS = ("pass", "fail", "insufficient", "unverified")
DECISIONS = ("approve", "reject", "needs_changes", "comment")
GATES = ("scheme", "representative", "final")
EVIDENCE = {"technical": "probe", "static": "frame", "dynamic": "playback", "audio": "listen"}
LABELS = {
    "pass": "通过",
    "fail": "需返修",
    "insufficient": "证据不足",
    "unverified": "未验证",
    "stale": "待复查",
    "approve": "用户已确认",
    "reject": "用户驳回",
    "needs_changes": "用户要求修改",
    "comment": "用户意见",
    "pending": "待用户确认",
    "technical": "技术",
    "static": "静态",
    "dynamic": "动态",
    "audio": "音频",
    "scheme": "替换方案与角色参考",
    "representative": "代表镜头",
    "final": "最终成片",
    "not_started": "尚未执行",
    "running": "执行中",
    "completed": "执行完成",
    "failed": "执行失败",
    "identity": "身份参考",
    "space": "构图与空间",
    "action": "动作参考",
    "timing": "时间与节奏",
    "probe": "文件检查",
    "frame": "画面检查",
    "playback": "播放检查",
    "listen": "试听检查",
}


class RecordError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise RecordError(message)


def digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def now():
    # This standalone skill also supports Python 3.10 (datetime.UTC arrived in 3.11).
    return datetime.now(timezone.utc).isoformat(timespec="seconds")  # noqa: UP017


def text(value, location, *, empty=True):
    require(isinstance(value, str), f"{location}: 必须为文本")
    require(empty or bool(value.strip()), f"{location}: 不得为空")


def sequence(value, location):
    require(isinstance(value, list), f"{location}: 必须为数组")
    return value


def obj(value, location):
    require(isinstance(value, dict), f"{location}: 必须为对象")
    return value


def unique(items, location):
    identifiers = []
    for item in sequence(items, location):
        obj(item, location)
        text(item.get("id"), f"{location}.id", empty=False)
        identifiers.append(item["id"])
    require(len(identifiers) == len(set(identifiers)), f"{location}: ID 重复")
    return set(identifiers)


def number(value, location):
    require(
        type(value) in (int, float) and math.isfinite(value) and value >= 0,
        f"{location}: 必须为有限非负秒数",
    )


def interval(value, location):
    sequence(value, location)
    require(len(value) == 2, f"{location}: 需要起止秒数")
    for item in value:
        number(item, location)
    require(value[1] > value[0], f"{location}: 结束必须晚于开始")


def media_path(value):
    text(value, "media.path", empty=False)
    require(
        not PurePosixPath(value).is_absolute()
        and not PureWindowsPath(value).is_absolute()
        and ":" not in value
        and "\\" not in value
        and "\x00" not in value
        and not any(part in ("..", ".") for part in value.split("/")),
        "media.path: 仅允许记录目录内的相对路径",
    )
    return value


def validate_media(media):
    if media is None:
        return
    obj(media, "media")
    require(media.get("kind") in ("image", "video", "audio"), "media.kind 无效")
    media_path(media.get("path"))
    for field in ("offset", "duration"):
        if field in media:
            number(media[field], f"media.{field}")
    text(media.get("sha256"), "media.sha256", empty=False)
    require(
        len(media["sha256"]) == 64 and all(c in "0123456789abcdef" for c in media["sha256"]),
        "media.sha256 必须为实际内容的 SHA256",
    )


def candidate_payload(candidate):
    return {k: v for k, v in candidate.items() if k not in ("checks", "label")}


def scheme_payload(record):
    return {key: record[key] for key in ("brief", "source", "characters", "scenes")}


def shot_payload(shot):
    return {
        key: shot[key]
        for key in (
            "id",
            "type",
            "source_range",
            "character_ids",
            "scene_id",
            "requirements",
            "references",
            "segments",
            "source_media",
            "required_checks",
        )
    }


def subject_hash(record, shot, candidate):
    return digest([scheme_payload(record), shot_payload(shot), candidate_payload(candidate)])


def gate_hash(record, gate):
    if gate == "scheme":
        return digest([scheme_payload(record), [shot_payload(s) for s in record["shots"]]])
    shots = record["shots"]
    if gate == "representative":
        shots = [s for s in shots if s["representative"]]
    selected = [[s["id"], s["selected_candidate_id"], fingerprints(record, s)] for s in shots]
    final = record["final"] if gate == "final" else None
    if final:
        final = {
            "candidate": candidate_payload(final["candidate"]) if final["candidate"] else None,
            "required_checks": final["required_checks"],
        }
    return digest([gate_hash(record, "scheme"), selected, final])


def fingerprints(record, shot):
    return {c["id"]: subject_hash(record, shot, c) for c in shot["candidates"]}


def final_hash(record):
    return gate_hash(record, "final")


def check_status(check, expected_hash):
    return check["verdict"] if check["subject_hash"] == expected_hash else "stale"


def candidate_status(record, shot, candidate):
    expected = subject_hash(record, shot, candidate)
    checks = {c["dimension"]: c for c in candidate["checks"]}
    statuses = [
        check_status(checks[d], expected) if d in checks else "unverified"
        for d in shot["required_checks"]
    ]
    for priority in ("fail", "stale", "insufficient", "unverified"):
        if priority in statuses:
            return priority
    return "pass" if statuses else "unverified"


def user_decision(record, shot, candidate):
    expected = subject_hash(record, shot, candidate)
    matches = [d for d in shot["decisions"] if d["candidate_id"] == candidate["id"]]
    substantive = [d for d in matches if d["decision"] != "comment"]
    decision = substantive[-1] if substantive else (matches[-1] if matches else None)
    if not decision:
        return "pending"
    return decision["decision"] if decision["subject_hash"] == expected else "stale"


def adopted_candidate(record, shot):
    adoption = shot["adopted"]
    if not adoption:
        return None
    candidate = next(c for c in shot["candidates"] if c["id"] == adoption["candidate_id"])
    if (
        adoption["subject_hash"] != subject_hash(record, shot, candidate)
        or candidate_status(record, shot, candidate) != "pass"
        or user_decision(record, shot, candidate) in ("reject", "needs_changes", "stale")
    ):
        return None
    return candidate


def gate_status(record, gate):
    entry = record["gates"][gate]
    if entry["decision"] == "pending":
        return "pending"
    if entry["subject_hash"] != gate_hash(record, gate):
        return "stale"
    if entry["decision"] == "approve" and gate != "scheme" and not gate_ready(record, gate):
        return "stale"
    return entry["decision"]


def gate_ready(record, gate):
    if gate == "scheme":
        return True
    if gate_status(record, "scheme") != "approve":
        return False
    shots = (
        record["shots"] if gate == "final" else [s for s in record["shots"] if s["representative"]]
    )
    if not shots:
        return False
    for shot in shots:
        if shot["type"] == "preserve":
            continue
        selected = next(
            (c for c in shot["candidates"] if c["id"] == shot["selected_candidate_id"]), None
        )
        if selected is None or candidate_status(record, shot, selected) != "pass":
            return False
        if user_decision(record, shot, selected) in ("reject", "needs_changes", "stale"):
            return False
        if gate == "final" and (adopted_candidate(record, shot) or {}).get("id") != selected["id"]:
            return False
    if gate == "final":
        final = record["final"]
        if (
            gate_status(record, "representative") != "approve"
            or not final["candidate"]
            or final["issues"]
        ):
            return False
        checks = {c["dimension"]: c for c in final["candidate"]["checks"]}
        return all(
            d in checks and check_status(checks[d], final_hash(record)) == "pass"
            for d in final["required_checks"]
        )
    return True


def validate_checks(candidate):
    checks = sequence(candidate.get("checks"), "candidate.checks")
    dimensions = []
    for check in checks:
        obj(check, "check")
        dimension = check.get("dimension")
        require(dimension in DIMENSIONS, "check.dimension 无效")
        dimensions.append(dimension)
        require(check.get("verdict") in VERDICTS, "check.verdict 无效")
        text(check.get("subject_hash"), "check.subject_hash", empty=False)
        text(check.get("note"), "check.note")
        evidence = sequence(check.get("evidence"), "check.evidence")
        for item in evidence:
            obj(item, "evidence")
            require(item.get("kind") in EVIDENCE.values(), "evidence.kind 无效")
            text(item.get("text"), "evidence.text", empty=False)
            number(item.get("time"), "evidence.time")
            if "end" in item:
                number(item["end"], "evidence.end")
                require(item["end"] >= item["time"], "证据区间倒置")
        if check["verdict"] == "pass":
            require(
                any(e["kind"] == EVIDENCE[dimension] for e in evidence),
                f"{dimension} 通过缺少对应实际证据",
            )
    require(len(set(dimensions)) == len(dimensions), "候选同维度检查重复")


def validate_candidate(candidate):
    obj(candidate, "candidate")
    text(candidate.get("id"), "candidate.id", empty=False)
    text(candidate.get("label"), "candidate.label", empty=False)
    require(candidate.get("stage") in ("still", "motion", "graphic", "final"), "候选阶段无效")
    obj(candidate.get("input_snapshot"), "candidate.input_snapshot")
    for field in ("node_id", "task_id", "asset_id", "output_id"):
        require(field in candidate, f"candidate 缺少 {field}")
        if candidate[field] is not None:
            text(candidate[field], f"candidate.{field}", empty=False)
    validate_media(candidate.get("media"))
    validate_checks(candidate)


def required_dimensions(value):
    sequence(value, "required_checks")
    require(all(isinstance(d, str) for d in value), "required_checks 维度必须为文本")
    require(bool(value) and len(value) == len(set(value)), "required_checks 为空或重复")
    require(all(d in DIMENSIONS for d in value), "required_checks 维度无效")


def validate(record):
    obj(record, "record")
    require(
        type(record.get("schema_version")) is int and record["schema_version"] == 1,
        "仅支持 schema_version 1",
    )
    require(type(record.get("revision")) is int and record["revision"] >= 0, "revision 无效")
    for field in ("record_id", "title", "updated_at", "phase"):
        text(record.get(field), field, empty=False)
    require(type(record.get("demo")) is bool, "demo 必须为布尔值")
    require(
        record.get("project_id") is None or isinstance(record["project_id"], str), "项目 ID 无效"
    )
    obj(record.get("brief"), "brief")
    obj(record.get("source"), "source")
    obj(record.get("app_nodes"), "app_nodes")
    for field in ("preserve", "replace"):
        for value in sequence(record["brief"].get(field), f"brief.{field}"):
            text(value, field)
    text(record["source"].get("audio_policy"), "source.audio_policy")
    validate_media(record["source"].get("media"))
    for field in ("blockers", "next_steps"):
        for value in sequence(record.get(field), field):
            text(value, field)
    characters = unique(record.get("characters"), "characters")
    scenes = unique(record.get("scenes"), "scenes")
    for field in ("characters", "scenes"):
        for entity in record[field]:
            text(entity.get("name"), f"{field}.name", empty=False)
            for ref in sequence(entity.get("references"), f"{field}.references"):
                validate_media(ref)
    unique(record.get("shots"), "shots")
    for shot in record["shots"]:
        text(shot.get("title"), "shot.title", empty=False)
        text(shot.get("stage"), "shot.stage", empty=False)
        text(shot.get("next_step"), "shot.next_step")
        require(
            shot.get("type") in ("person", "interaction", "scene", "graphic", "preserve"),
            "镜头类型无效",
        )
        require(
            shot.get("execution_status") in ("not_started", "running", "completed", "failed"),
            "任务状态无效",
        )
        require(type(shot.get("representative")) is bool, "representative 无效")
        interval(shot.get("source_range"), "shot.source_range")
        for character in sequence(shot.get("character_ids"), "character_ids"):
            require(character in characters, "镜头引用未知人物")
        require(shot.get("scene_id") is None or shot["scene_id"] in scenes, "镜头引用未知场景")
        required_dimensions(shot.get("required_checks"))
        for value in sequence(shot.get("requirements"), "requirements"):
            text(value, "requirement", empty=False)
        for ref in sequence(shot.get("references"), "references"):
            obj(ref, "reference")
            require(ref.get("role") in ("identity", "space", "action", "timing"), "参考职责无效")
            text(ref.get("description"), "reference.description", empty=False)
            validate_media(ref.get("media"))
        validate_media(shot.get("source_media"))
        segments = sequence(shot.get("segments"), "segments")
        cursor = shot["source_range"][0]
        for segment in segments:
            obj(segment, "segment")
            interval(segment.get("range"), "segment.range")
            text(segment.get("reason"), "segment.reason", empty=False)
            require(abs(segment["range"][0] - cursor) < 1e-6, "动作段落必须连续覆盖镜头")
            cursor = segment["range"][1]
        if segments:
            require(abs(cursor - shot["source_range"][1]) < 1e-6, "动作段落未覆盖完整镜头")
        candidates = unique(shot.get("candidates"), "candidates")
        for candidate in shot["candidates"]:
            validate_candidate(candidate)
        selected = shot.get("selected_candidate_id")
        require(selected is None or selected in candidates, "选中未知候选")
        for decision in sequence(shot.get("decisions"), "decisions"):
            obj(decision, "decision")
            require(decision.get("candidate_id") in candidates, "用户意见引用未知候选")
            require(decision.get("decision") in DECISIONS, "用户决定无效")
            for field in ("subject_hash", "note", "at"):
                text(decision.get(field), f"decision.{field}", empty=field == "note")
        adoption = shot.get("adopted")
        if adoption is not None:
            obj(adoption, "adopted")
            require(adoption.get("candidate_id") in candidates, "采用未知候选")
            text(adoption.get("subject_hash"), "adopted.subject_hash", empty=False)
        for repair in sequence(shot.get("repairs"), "repairs"):
            obj(repair, "repair")
            require(repair.get("from_candidate_id") in candidates, "返修来源候选无效")
            require(
                repair.get("to_candidate_id") is None or repair["to_candidate_id"] in candidates,
                "返修目标候选无效",
            )
            interval(repair.get("range"), "repair.range")
            for field in ("problem", "cause", "change", "comparison"):
                text(repair.get(field), f"repair.{field}")
    obj(record.get("gates"), "gates")
    for gate in GATES:
        entry = obj(record["gates"].get(gate), f"gate.{gate}")
        require(
            entry.get("decision") in ("pending", "approve", "reject", "needs_changes"),
            "关口决定无效",
        )
        for field in ("note", "at"):
            text(entry.get(field), f"gate.{field}")
        require(
            entry.get("subject_hash") is None or isinstance(entry["subject_hash"], str),
            "关口哈希无效",
        )
    final = obj(record.get("final"), "final")
    text(final.get("summary"), "final.summary")
    required_dimensions(final.get("required_checks"))
    for issue in sequence(final.get("issues"), "final.issues"):
        text(issue, "final.issue")
    if final.get("candidate") is not None:
        validate_candidate(final["candidate"])
    return record


def reconcile(record):
    result = copy.deepcopy(validate(record))
    for shot in result["shots"]:
        if shot["adopted"] and not adopted_candidate(result, shot):
            shot["adopted"] = None
            shot["next_step"] = "候选或要求已变化，重新 review 后决定采用"
    result["revision"] += 1
    result["updated_at"] = now()
    return result


def merge_feedback(record, feedback):
    validate(record)
    obj(feedback, "feedback")
    require(feedback.get("schema_version") == 1, "反馈版本无效")
    require(feedback.get("record_id") == record["record_id"], "反馈属于其他制作记录")
    require(
        type(feedback.get("revision")) is int and feedback["revision"] == record["revision"],
        "反馈 revision 已过期",
    )
    require(feedback.get("snapshot_hash") == digest(record), "反馈快照已变化")
    entries = sequence(feedback.get("entries"), "feedback.entries")
    require(bool(entries), "反馈为空")
    for entry in entries:
        obj(entry, "feedback.entry")
    order = {"scheme": 1, "representative": 2, "final": 3}
    entries = sorted(
        entries, key=lambda e: 0 if e.get("kind") == "candidate" else order.get(e.get("gate"), 4)
    )
    result = copy.deepcopy(record)
    seen = set()
    for entry in entries:
        obj(entry, "feedback.entry")
        decision = entry.get("decision")
        require(decision in DECISIONS, "反馈决定无效")
        text(entry.get("note"), "feedback.note")
        require(decision == "approve" or bool(entry["note"].strip()), "非批准反馈需要意见")
        kind = entry.get("kind")
        require(kind in ("candidate", "gate"), "反馈对象无效")
        if kind == "gate":
            gate = entry.get("gate")
            require(gate in GATES and decision != "comment", "关口反馈无效")
            key = (kind, gate)
            require(entry.get("subject_hash") == gate_hash(result, gate), "关口反馈已过期")
            if decision == "approve":
                require(gate_ready(result, gate), "关口前置确认、镜头采用或所需检查尚未通过")
            result["gates"][gate] = {
                "decision": decision,
                "subject_hash": entry["subject_hash"],
                "note": entry["note"],
                "at": now(),
            }
        else:
            shot = next((s for s in result["shots"] if s["id"] == entry.get("shot_id")), None)
            require(shot is not None, "反馈引用未知镜头")
            candidate = next(
                (c for c in shot["candidates"] if c["id"] == entry.get("candidate_id")), None
            )
            require(candidate is not None, "反馈引用未知候选")
            key = (kind, shot["id"], candidate["id"])
            require(
                entry.get("subject_hash") == subject_hash(result, shot, candidate), "候选反馈已过期"
            )
            shot["decisions"].append(
                {
                    "candidate_id": candidate["id"],
                    "decision": decision,
                    "subject_hash": entry["subject_hash"],
                    "note": entry["note"],
                    "at": now(),
                }
            )
        require(key not in seen, "同一对象包含重复/冲突反馈")
        seen.add(key)
    return reconcile(result)
