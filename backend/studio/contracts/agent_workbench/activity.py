"""Allowlisted display fields shared by native history and managed activity."""

import json
from typing import Literal

from pydantic import BaseModel, Field


class ActivityFile(BaseModel):
    path: str
    line: int | None = None


class ActivityDetails(BaseModel):
    kind: Literal["file", "search", "web", "question", "command", "duration"]
    label: str | None = None
    file: ActivityFile | None = None
    questions: list[str] = Field(default_factory=list)
    answers: list[str] = Field(default_factory=list)
    duration_ms: int | None = None


def display_text(value, limit=500):
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def positive_int(value):
    return value if type(value) is int and 0 < value < 2**31 else None


def fields(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, RecursionError):
            return {}
    return value if isinstance(value, dict) else {}


def question_answers(value):
    data = fields(value)
    answers = data.get("answers")
    if isinstance(answers, dict):
        answers = list(answers.values())
    if not isinstance(answers, list):
        return []
    result = []
    for item in answers[:12]:
        if isinstance(item, dict):
            item = item.get("answers", item.get("answer"))
        if isinstance(item, list):
            result.extend(answer for value in item[:6] if (answer := display_text(value)))
        elif answer := display_text(item):
            result.append(answer)
    return result


def tool_details(name, input_value, *, result=None, duration=None):
    tool = name.casefold().replace("_", "") if isinstance(name, str) else ""
    args = fields(input_value)
    timing = positive_int(duration)
    if tool in {"read", "readfile", "viewfile", "write", "writefile", "edit", "multiedit"}:
        value = args.get("path") or args.get("file_path")
        path = value if isinstance(value, str) and value.strip() and len(value) <= 4096 else None
        line = positive_int(args.get("line") or args.get("start_line") or args.get("offset"))
        return {
            "kind": "file",
            "file": {"path": path, "line": line} if path else None,
            "duration_ms": timing,
        }
    if tool in {"websearch", "web"}:
        return {"kind": "web", "label": display_text(args.get("query")), "duration_ms": timing}
    if tool in {"search", "grep", "glob", "rg", "searchfiles", "searchtext"}:
        return {
            "kind": "search",
            "label": display_text(args.get("query") or args.get("pattern")),
            "duration_ms": timing,
        }
    if tool in {"askuserquestion", "requestuserinput", "question"}:
        questions = args.get("questions")
        return {
            "kind": "question",
            "questions": [
                question
                for item in questions[:12]
                if (
                    question := display_text(
                        item.get("question") if isinstance(item, dict) else item
                    )
                )
            ]
            if isinstance(questions, list)
            else [],
            "answers": question_answers(result),
        }
    if tool in {"exec", "execcommand", "runcommand", "bash", "shell", "terminal"}:
        return {
            "kind": "command",
            "label": display_text(args.get("cmd") or args.get("command") or args.get("preset")),
            "duration_ms": timing,
        }
    return {"kind": "duration", "duration_ms": timing} if timing else None
