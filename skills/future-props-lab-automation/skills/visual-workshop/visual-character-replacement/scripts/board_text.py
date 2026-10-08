"""Six supervision templates derived from the same production record."""

from __future__ import annotations

import html
from pathlib import Path
from string import Template

from production_record import (
    DIMENSIONS,
    GATES,
    LABELS,
    adopted_candidate,
    candidate_status,
    check_status,
    final_hash,
    gate_status,
    subject_hash,
    user_decision,
)


def safe(value):
    return html.escape(str(value), quote=False).replace("|", "\\|").replace("\n", " / ")


def bullets(values):
    return "\n".join(f"- {safe(v)}" for v in values) or "- 暂无"


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines.extend("| " + " | ".join(safe(v) for v in row) + " |" for row in rows)
    return "\n".join(lines)


def selected(shot):
    return next((c for c in shot["candidates"] if c["id"] == shot["selected_candidate_id"]), None)


def checks_text(checks, expected):
    parts = []
    by_dimension = {c["dimension"]: c for c in checks}
    for dimension in DIMENSIONS:
        check = by_dimension.get(dimension)
        status = check_status(check, expected) if check else "unverified"
        parts.append(f"{LABELS[dimension]}：{LABELS[status]}")
        if check:
            parts.append(safe(check["note"]))
            parts.extend(
                f"证据 {LABELS[e['kind']]} @{e['time']:g}s：{safe(e['text'])}"
                for e in check["evidence"]
            )
    return "\n\n".join(parts)


def make_texts(record, templates: Path):
    overview = []
    shots, comparisons, repairs = [], [], []
    for shot in record["shots"]:
        candidate = selected(shot)
        overview.append(
            [
                shot["id"] + " · " + shot["title"],
                shot["stage"],
                LABELS[shot["execution_status"]],
                LABELS[candidate_status(record, shot, candidate)] if candidate else "未验证",
                LABELS[user_decision(record, shot, candidate)] if candidate else "尚未提交",
                shot["next_step"],
            ]
        )
        adopted = adopted_candidate(record, shot)
        reference_lines = [LABELS[r["role"]] + "：" + r["description"] for r in shot["references"]]
        segment_lines = [str(s["range"]) + "：" + s["reason"] for s in shot["segments"]]
        shots.append(
            f"## {safe(shot['id'])} · {safe(shot['title'])}\n\n"
            f"源时间：{shot['source_range'][0]:g}–{shot['source_range'][1]:g}s；"
            f"人物：{safe(', '.join(shot['character_ids']) or '无')}；"
            f"场景：{safe(shot['scene_id'] or '沿用原片')}。\n\n"
            f"要求：\n\n{bullets(shot['requirements'])}\n\n"
            f"参考：\n\n{bullets(reference_lines)}\n\n"
            f"动作段落：\n\n{bullets(segment_lines)}\n\n"
            f"明确采用：{safe(adopted['id']) if adopted else '尚未采用'}"
        )
        for c in shot["candidates"]:
            comparisons.append(
                f"## {safe(shot['id'])} / {safe(c['label'])}\n\n"
                f"候选 ID：{safe(c['id'])}；节点：{safe(c['node_id'])}；"
                f"任务：{safe(c['task_id'])}；素材：{safe(c['asset_id'])}；"
                f"输出：{safe(c['output_id'])}。\n\n"
                + checks_text(c["checks"], subject_hash(record, shot, c))
                + f"\n\n用户结论：{LABELS[user_decision(record, shot, c)]}\n\n"
                + bullets(
                    [
                        LABELS[d["decision"]] + "：" + d["note"]
                        for d in shot["decisions"]
                        if d["candidate_id"] == c["id"]
                    ]
                )
            )
        for repair in shot["repairs"]:
            repairs.append(
                f"## {safe(shot['id'])} · {safe(repair['from_candidate_id'])} → "
                f"{safe(repair['to_candidate_id'] or '待制作')}\n\n"
                f"问题区间：{safe(repair['range'])}\n\n"
                + bullets(
                    [
                        f"{label}：{repair[field]}"
                        for field, label in (
                            ("problem", "问题"),
                            ("cause", "根因判断"),
                            ("change", "修改"),
                            ("comparison", "复查与退化检查"),
                        )
                    ]
                )
            )
    refs = []
    for field, label in (("characters", "人物映射"), ("scenes", "场景参考")):
        refs.append(
            f"## {label}\n\n"
            + bullets(
                [
                    f"{e['id']} · {e['name']}：{e.get('mapping', e.get('description', ''))}"
                    f"；参考 {len(e['references'])} 份"
                    for e in record[field]
                ]
            )
        )
    final = record["final"]
    final_text = (
        checks_text(final["candidate"]["checks"], final_hash(record))
        if final["candidate"]
        else "尚无成片候选；各维度未验证。"
    )
    common = {
        "title": safe(record["title"]),
        "revision": record["revision"],
        "updated_at": safe(record["updated_at"]),
        "demo": "演示数据 · 未执行真实生成" if record["demo"] else "制作记录快照",
    }
    contexts = {
        "overview": {
            "phase": safe(record["phase"]),
            "progress": table(
                ["镜头", "制作阶段", "任务执行", "Agent review", "用户 review", "下一步"], overview
            ),
            "gates": bullets([LABELS[g] + "：" + LABELS[gate_status(record, g)] for g in GATES]),
            "blockers": bullets(record["blockers"]),
            "next_steps": bullets(record["next_steps"]),
        },
        "references": {
            "preserve": bullets(record["brief"]["preserve"]),
            "replace": bullets(record["brief"]["replace"]),
            "entities": "\n\n".join(refs),
            "audio_policy": safe(record["source"]["audio_policy"]),
        },
        "shots": {"shots": "\n\n".join(shots) or "尚未拆镜。"},
        "candidates": {"candidates": "\n\n".join(comparisons) or "尚无候选。"},
        "repairs": {"repairs": "\n\n".join(repairs) or "暂无返修。"},
        "final": {
            "summary": safe(final["summary"]),
            "checks": final_text,
            "issues": bullets(final["issues"]),
            "adoptions": table(
                ["镜头", "采用候选"],
                [
                    [
                        s["id"],
                        adopted_candidate(record, s)["id"]
                        if adopted_candidate(record, s)
                        else ("原样保留" if s["type"] == "preserve" else "尚未采用"),
                    ]
                    for s in record["shots"]
                ],
            ),
            "decision": LABELS[gate_status(record, "final")],
        },
    }
    return {
        name: Template((templates / f"{name}.md").read_text()).substitute(common | fields)
        for name, fields in contexts.items()
    }
