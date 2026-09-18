from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.apps.galgame_workshop.schemas import GalgameVideoExportIssue
from app.apps.galgame_workshop.story.story_flow import TIMED_ROUTE_BOUNDARY_TYPES

PRESETS = {
    "1080p30": (1920, 1080, 30),
    "720p30": (1280, 720, 30),
    "1080p60": (1920, 1080, 60),
    "720p60": (1280, 720, 60),
}
CHOICE_DURATION_MS = 2000
CHOICE_HIGHLIGHT_MS = 500
MAX_ROUTE_STEPS = 20_000
EXPORT_PACKAGING_POLICY = "include"


@dataclass
class _RoutePlan:
    chapter_ids: list[str] = field(default_factory=list)
    fragment_ids: list[str] = field(default_factory=list)
    fragment_durations_ms: list[int] = field(default_factory=list)
    branch_block_ids: list[str] = field(default_factory=list)
    duration_ms: int = 0
    exact_duration: bool = True
    ending_label: str = "故事结束"
    decision: dict[str, Any] | None = None
    blockers: list[GalgameVideoExportIssue] = field(default_factory=list)
    warnings: list[GalgameVideoExportIssue] = field(default_factory=list)
    used_selections: set[str] = field(default_factory=set)


_TOKEN = re.compile(
    r"\s*(?:(?P<string>\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*')|"
    r"(?P<number>-?\d+(?:\.\d+)?)|(?P<operator>===|!==|==|!=|>=|<=|&&|\|\||>|<|!)|"
    r"(?P<paren>[()])|(?P<identifier>[a-zA-Z_][a-zA-Z0-9_.-]*))"
)


def _evaluate_expression(source: str, values: dict[str, Any]) -> bool:
    tokens: list[tuple[str, str]] = []
    position = 0
    while position < len(source):
        match = _TOKEN.match(source, position)
        if not match:
            raise ValueError(f"条件表达式包含不支持的字符：{source[position]}")
        kind = next(key for key, value in match.groupdict().items() if value is not None)
        tokens.append((kind, match.group(kind)))
        position = match.end()
    cursor = 0

    def primary() -> Any:
        nonlocal cursor
        if cursor >= len(tokens):
            raise ValueError("条件表达式不完整")
        kind, value = tokens[cursor]
        cursor += 1
        if kind == "paren" and value == "(":
            result = parse_or()
            if cursor >= len(tokens) or tokens[cursor][1] != ")":
                raise ValueError("条件表达式缺少右括号")
            cursor += 1
            return result
        if kind == "number":
            return float(value) if "." in value else int(value)
        if kind == "string":
            if value.startswith("'"):
                value = json.dumps(value[1:-1].replace("\\'", "'"))
            return json.loads(value)
        if kind != "identifier":
            raise ValueError("条件表达式需要变量或常量")
        if value == "true":
            return True
        if value == "false":
            return False
        if value not in values:
            raise ValueError(f"未声明的变量：{value}")
        return values[value]

    def unary() -> Any:
        nonlocal cursor
        if cursor < len(tokens) and tokens[cursor][1] == "!":
            cursor += 1
            return not bool(unary())
        return primary()

    def comparison() -> Any:
        nonlocal cursor
        left = unary()
        if cursor >= len(tokens) or tokens[cursor][1] not in {
            "===",
            "!==",
            "==",
            "!=",
            ">",
            "<",
            ">=",
            "<=",
        }:
            return left
        operator = tokens[cursor][1]
        cursor += 1
        right = unary()
        if operator in {"==", "==="}:
            return type(left) is type(right) and left == right
        if operator in {"!=", "!=="}:
            return not (type(left) is type(right) and left == right)
        if (
            not isinstance(left, (int, float))
            or isinstance(left, bool)
            or not isinstance(right, (int, float))
            or isinstance(right, bool)
        ):
            raise ValueError("大小比较只支持数值变量")
        return {">": left > right, "<": left < right, ">=": left >= right, "<=": left <= right}[
            operator
        ]

    def parse_and() -> Any:
        nonlocal cursor
        value = comparison()
        while cursor < len(tokens) and tokens[cursor][1] == "&&":
            cursor += 1
            right = comparison()
            value = bool(value) and bool(right)
        return value

    def parse_or() -> Any:
        nonlocal cursor
        value = parse_and()
        while cursor < len(tokens) and tokens[cursor][1] == "||":
            cursor += 1
            right = parse_and()
            value = bool(value) or bool(right)
        return value

    result = bool(parse_or())
    if cursor != len(tokens):
        raise ValueError("条件表达式存在多余内容")
    return result


def _content_text(block: dict[str, Any]) -> str:
    if isinstance(block.get("text"), str):
        return block["text"]
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return str(content.get("text", ""))
    return ""


def _estimate_block_ms(block: dict[str, Any], asset_duration: dict[str, int]) -> tuple[int, bool]:
    block_type = block.get("type")
    if block_type in {"dialogue", "narration", "storyParagraph", "floatingText"}:
        voice_id = block.get("voiceAssetId")
        if voice_id and voice_id in asset_duration:
            return asset_duration[voice_id] + 400, False
        speed = max(1, int(block.get("textSpeedCps") or 40))
        return max(400, round(len(_content_text(block)) / speed * 1000) + 400), False
    if block_type == "wait":
        if block.get("mode") == "player":
            return 1200, False
        return max(0, int(block.get("durationMs", 0))), True
    if block_type == "systemMessage":
        return 1200, False
    if block.get("waitForCompletion") and isinstance(block.get("durationMs"), int):
        return max(0, block["durationMs"]), True
    return 0, True


def _plan_route(
    document: dict[str, Any],
    selections: dict[str, str],
    asset_duration: dict[str, int],
) -> _RoutePlan:
    plan = _RoutePlan()
    chapters = sorted(
        [chapter for chapter in document.get("chapters", []) if not chapter.get("disabled")],
        key=lambda chapter: chapter.get("order", 0),
    )
    chapter_by_id = {chapter["id"]: chapter for chapter in chapters}
    chapter_id = document.get("entryChapterId")
    chapter = chapter_by_id.get(chapter_id)
    if chapter is None:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="missing_entry", message="项目入口章节不存在", path="/entryChapterId"
            )
        )
        return plan
    fragment_id = chapter.get("entryFragmentId")
    block_index = 0
    call_stack: list[tuple[str, str, int]] = []
    variables = {item["id"]: item.get("defaultValue") for item in document.get("variables", [])}
    for character in document.get("characters", []):
        for attribute_id, value in character.get("attributes", {}).items():
            variables[f"character.{character['id']}.{attribute_id}"] = value
    timed_fragments: set[tuple[str, str, int]] = set()

    def enter(target: str) -> None:
        nonlocal fragment_id, block_index
        call_stack.append((chapter_id, fragment_id, block_index + 1))
        fragment_id = target
        block_index = 0

    for _step in range(MAX_ROUTE_STEPS):
        chapter = chapter_by_id.get(chapter_id)
        fragments = {item["id"]: item for item in (chapter or {}).get("fragments", [])}
        fragment = fragments.get(fragment_id)
        if chapter is None or fragment is None:
            plan.blockers.append(
                GalgameVideoExportIssue(
                    code="missing_fragment",
                    message="路线引用了不存在的章节或 Fragment",
                    path=f"/chapters/{chapter_id}/fragments/{fragment_id}",
                )
            )
            return plan
        if not plan.chapter_ids or plan.chapter_ids[-1] != chapter_id:
            plan.chapter_ids.append(chapter_id)
        if not plan.fragment_ids or plan.fragment_ids[-1] != fragment_id:
            plan.fragment_ids.append(fragment_id)
        timeline = fragment.get("timeline")
        visit = (chapter_id, fragment_id, len(call_stack))
        if timeline and visit not in timed_fragments:
            plan.duration_ms += max(0, int(timeline.get("durationMs", 0)))
            timed_fragments.add(visit)
            terminator = next(
                (
                    (index, item)
                    for index, item in enumerate(fragment.get("blocks", []))
                    if item.get("type") in TIMED_ROUTE_BOUNDARY_TYPES
                ),
                None,
            )
            block_index = terminator[0] if terminator else len(fragment.get("blocks", []))
        blocks = fragment.get("blocks", [])
        if block_index >= len(blocks):
            if call_stack:
                chapter_id, fragment_id, block_index = call_stack.pop()
                continue
            plan.ending_label = "故事结束"
            break
        block = blocks[block_index]
        block_type = block.get("type")
        block_id = block.get("id", f"block-{block_index}")
        if block_type == "branch":
            if block_id in plan.branch_block_ids:
                plan.blockers.append(
                    GalgameVideoExportIssue(
                        code="repeated_branch",
                        message="所选路线重复回到同一分支，无法生成有限视频",
                        path=f"/blocks/{block_id}",
                    )
                )
                return plan
            plan.branch_block_ids.append(block_id)
            chosen_id = selections.get(block_id)
            choice = next(
                (item for item in block.get("choices", []) if item.get("id") == chosen_id),
                None,
            )
            if choice is None:
                if chosen_id is not None:
                    plan.blockers.append(
                        GalgameVideoExportIssue(
                            code="invalid_choice",
                            message="分支选择已失效，请重新选择",
                            path=f"/blocks/{block_id}",
                        )
                    )
                plan.decision = block
                return plan
            plan.used_selections.add(block_id)
            plan.duration_ms += CHOICE_DURATION_MS
            enter(choice["targetFragmentId"])
            continue
        if block_type == "setVariable":
            variable_id = block.get("variableId")
            current = variables.get(variable_id)
            value = block.get("value")
            operator = block.get("operator", "set")
            if operator == "toggle":
                value = not bool(current)
            elif isinstance(current, (int, float)) and isinstance(value, (int, float)):
                if operator == "add":
                    value = current + value
                elif operator == "subtract":
                    value = current - value
                elif operator == "multiply":
                    value = current * value
                elif operator == "divide":
                    value = current if value == 0 else current / value
            variables[variable_id] = value
            block_index += 1
            continue
        if block_type == "if":
            try:
                matched = _evaluate_expression(str(block.get("condition", "")), variables)
            except ValueError as exc:
                plan.blockers.append(
                    GalgameVideoExportIssue(
                        code="invalid_condition", message=str(exc), path=f"/blocks/{block_id}"
                    )
                )
                return plan
            target = block.get("thenFragmentId") if matched else block.get("elseFragmentId")
            if target:
                enter(target)
            else:
                block_index += 1
            continue
        if block_type == "callFragment":
            enter(block["targetFragmentId"])
            continue
        if block_type == "endChapter":
            current_index = next(
                (index for index, item in enumerate(chapters) if item["id"] == chapter_id), -1
            )
            next_chapter = (
                chapters[current_index + 1] if current_index + 1 < len(chapters) else None
            )
            if next_chapter is None:
                plan.ending_label = block.get("label") or "故事结束"
                break
            chapter_id = next_chapter["id"]
            fragment_id = next_chapter["entryFragmentId"]
            block_index = 0
            call_stack.clear()
            continue
        if block_type == "returnToEntry":
            plan.blockers.append(
                GalgameVideoExportIssue(
                    code="return_to_entry_loop",
                    message="路线返回项目入口，无法确定有限导出时长",
                    path=f"/blocks/{block_id}",
                )
            )
            return plan
        duration, exact = _estimate_block_ms(block, asset_duration)
        plan.duration_ms += duration
        plan.exact_duration = plan.exact_duration and exact
        block_index += 1
    else:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="route_step_limit",
                message="路线执行超过安全步数，请检查递归或循环",
                path="/chapters",
            )
        )
    for branch_id in sorted(set(selections) - plan.used_selections):
        plan.warnings.append(
            GalgameVideoExportIssue(
                code="unused_selection",
                message="有一项分支选择不在当前路线中，已忽略",
                path=f"/branchSelections/{branch_id}",
            )
        )
    return plan


def _plan_fragments(
    document: dict[str, Any],
    fragment_ids: list[str],
    asset_duration: dict[str, int],
) -> _RoutePlan:
    plan = _RoutePlan()
    fragment_locations = {
        fragment["id"]: (chapter, fragment)
        for chapter in document.get("chapters", [])
        for fragment in chapter.get("fragments", [])
    }
    selected: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for index, fragment_id in enumerate(fragment_ids):
        location = fragment_locations.get(fragment_id)
        if location is None:
            plan.blockers.append(
                GalgameVideoExportIssue(
                    code="missing_selected_fragment",
                    message=f"所选 Fragment“{fragment_id}”已不存在",
                    path=f"/fragmentIds/{index}",
                )
            )
            continue
        selected.append(location)

    if plan.blockers:
        return plan
    for chapter, fragment in selected:
        plan.chapter_ids.append(chapter["id"])
        plan.fragment_ids.append(fragment["id"])
        duration_before = plan.duration_ms
        timeline = fragment.get("timeline")
        if timeline:
            plan.duration_ms += max(0, int(timeline.get("durationMs", 0)))
            plan.fragment_durations_ms.append(plan.duration_ms - duration_before)
            continue
        for block in fragment.get("blocks", []):
            if block.get("type") in {
                "branch",
                "if",
                "callFragment",
                "endChapter",
                "returnToEntry",
            }:
                continue
            duration, exact = _estimate_block_ms(block, asset_duration)
            plan.duration_ms += duration
            plan.exact_duration = plan.exact_duration and exact
        plan.fragment_durations_ms.append(plan.duration_ms - duration_before)
    if len(selected) == 1:
        plan.ending_label = selected[0][1].get("title") or "单个片段"
    else:
        plan.ending_label = f"{len(selected)} 个片段"
    return plan


def _clip_time_label(milliseconds: int) -> str:
    value = max(0, milliseconds)
    total_seconds, millis = divmod(value, 1000)
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes:02d}m{seconds:02d}.{millis:03d}s"


def _plan_clip(
    document: dict[str, Any], fragment_id: str, start_ms: int, end_ms: int
) -> _RoutePlan:
    plan = _RoutePlan()
    location = next(
        (
            (chapter, fragment)
            for chapter in document.get("chapters", [])
            for fragment in chapter.get("fragments", [])
            if fragment.get("id") == fragment_id
        ),
        None,
    )
    if location is None:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="missing_clip_fragment",
                message=f"快速试片 Fragment“{fragment_id}”已不存在",
                path="/clipRange/fragmentId",
            )
        )
        return plan
    chapter, fragment = location
    timeline = fragment.get("timeline")
    if not timeline:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="clip_fragment_without_timeline",
                message="快速试片只支持带时间轴的 Fragment",
                path="/clipRange/fragmentId",
            )
        )
        return plan
    duration_ms = max(0, int(timeline.get("durationMs", 0)))
    if start_ms >= duration_ms or end_ms > duration_ms:
        plan.blockers.append(
            GalgameVideoExportIssue(
                code="clip_range_out_of_bounds",
                message="快速试片范围超出了当前 Fragment 的时间轴",
                path="/clipRange",
            )
        )
        return plan
    clip_duration_ms = end_ms - start_ms
    plan.chapter_ids.append(chapter["id"])
    plan.fragment_ids.append(fragment_id)
    plan.fragment_durations_ms.append(clip_duration_ms)
    plan.duration_ms = clip_duration_ms
    plan.ending_label = (
        f"{fragment.get('title') or fragment_id} · "
        f"{_clip_time_label(start_ms)}-{_clip_time_label(end_ms)}"
    )
    return plan
