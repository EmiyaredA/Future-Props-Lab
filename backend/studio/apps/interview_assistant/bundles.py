"""Validate semantic references separately from the JSON output schema."""

import json
from pathlib import Path
from urllib.parse import urlsplit

from studio.contracts.interview_assistant.documents import PreparationBundle


def acceptance(
    bundle: PreparationBundle, task_id: str, input_hash: str, root: Path, search_count: int
) -> list[str]:
    problems = []
    if bundle.task_id != task_id or bundle.input_hash != input_hash:
        problems.append("交付与本次输入快照不一致")
    manifest = json.loads((root / "manifest.json").read_text())
    receipts = {}
    for file_id in manifest["files"]:
        path = root / "receipts" / f"{file_id}.json"
        if not path.is_file() or path.is_symlink():
            problems.append(f"未读取输入材料：{file_id}")
            continue
        value = json.loads(path.read_text())
        if not value["complete"] or value["sha256"] != manifest["files"][file_id]["sha256"]:
            problems.append(f"输入材料未完整读取：{file_id}")
        receipts[file_id] = value
    if not bundle.material_complete:
        problems.append("Codex 报告材料不完整")
    if search_count < 1:
        problems.append("未观察到已完成的联网搜索")

    def identifiers(items, name):
        ids = [item.id for item in items]
        if any(not item.strip() for item in ids) or len(ids) != len(set(ids)):
            problems.append(f"{name}标识为空或重复")
        return set(ids)

    sources = identifiers(bundle.sources, "来源")
    requirements = identifiers(bundle.requirements, "岗位要求")
    experiences = identifiers(bundle.experiences, "经历")
    questions = identifiers(bundle.questions, "问题")
    topics = identifiers(bundle.topics, "主题")
    valid_urls = set()
    for source in bundle.sources:
        try:
            url = urlsplit(source.url)
            if (
                url.scheme not in {"http", "https"}
                or not url.hostname
                or url.username
                or url.password
                or not source.title.strip()
                or not source.excerpt.strip()
            ):
                raise ValueError
            valid_urls.add(url._replace(fragment="").geturl().rstrip("/"))
        except ValueError:
            problems.append("来源 URL、标题或引用片段无效")
        if (
            not source.retrieved_at.strip()
            or not source.supports
            or not set(source.supports) <= (topics | requirements | questions)
        ):
            problems.append("来源缺少检索时间或有效结论关联")
    if len(valid_urls) < 3:
        problems.append("至少需要三条不同的相关网络来源")
    if not requirements or not experiences or not bundle.topics or not bundle.rubric:
        problems.append("岗位、经历、知识主题或评价依据缺失")
    if (
        len(bundle.questions) != 6
        or len(bundle.first_round) != 3
        or len(set(bundle.first_round)) != 3
    ):
        problems.append("需要六道候选题和三道不重复的首轮问题")
    if not set(bundle.first_round) <= questions:
        problems.append("首轮问题引用不存在")
    for item in [*bundle.requirements, *bundle.experiences]:
        if not item.evidence:
            problems.append("岗位或经历缺少原文依据")
        for ref in item.evidence:
            sections = receipts.get(ref.file_id, {}).get("sections", [])
            if not any(
                section["location"] == ref.location
                and ref.excerpt.strip()
                and ref.excerpt.strip() in section["text"]
                for section in sections
            ):
                problems.append("原文定位或引用与已读取材料不符")
    if any(not any(ref.file_id == "jd" for ref in item.evidence) for item in bundle.requirements):
        problems.append("岗位能力缺少 JD 原文依据")
    if any(
        not any(ref.file_id in {"resume", "supplement"} for ref in item.evidence)
        for item in bundle.experiences
    ):
        problems.append("经历缺少简历原文依据")
    if not any(question.experience_ids for question in bundle.questions):
        problems.append("问题未关联任何简历经历")
    for topic in bundle.topics:
        if not topic.source_ids or not set(topic.source_ids) <= sources:
            problems.append("知识主题缺少有效来源")
    for question in bundle.questions:
        if (
            not question.question.strip()
            or not question.answer_points
            or not question.requirement_ids
            or not set(question.requirement_ids) <= requirements
            or not set(question.experience_ids) <= experiences
            or not question.source_ids
            or not set(question.source_ids) <= sources
        ):
            problems.append("问题蓝图缺少有效岗位／经历／来源依据")
    for dimension in bundle.rubric:
        if not dimension.question_ids or not set(dimension.question_ids) <= questions:
            problems.append("评价维度引用了不存在的问题")
    return list(dict.fromkeys(problems))


def markdown(bundle: PreparationBundle) -> str:
    lines = [
        "# 本场面试资料",
        "",
        "> 由 Codex 联网整理；结构验收不等同于事实核实。",
        "",
        bundle.material_summary,
        "",
        "## 岗位与经历",
    ]
    lines += [f"- {item.capability}" for item in bundle.requirements]
    lines += [f"- {item.title}：{item.summary}" for item in bundle.experiences]
    for topic in bundle.topics:
        lines += [
            "",
            f"## {topic.title}",
            topic.summary,
            topic.relevance,
            *[f"- {point}" for point in topic.key_points],
            f"来源：{', '.join(topic.source_ids)}",
        ]
    lines += ["", "## 问题蓝图"]
    for question in bundle.questions:
        lines += [
            "",
            f"### {question.id} · {question.question}",
            question.objective,
            *[f"- {point}" for point in question.answer_points],
        ]
    lines += ["", "## 来源"]
    for source in bundle.sources:
        lines += [
            f"- {source.id} · {source.title} — {source.url}",
            f"  检索：{source.retrieved_at}；版本：{source.version or '未确定'}",
            source.excerpt,
        ]
    lines += ["", "## 限制与待核实事项", *[f"- {item}" for item in bundle.limitations]]
    return "\n".join(lines)
