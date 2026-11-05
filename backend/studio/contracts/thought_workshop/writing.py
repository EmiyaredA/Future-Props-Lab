"""Narrow Thought-to-Models writing protocol; credentials and provider values stay in Models."""

import hashlib
import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WRITING_MODELS_PATH = "/_internal/v1/writing/models"
WRITING_COMPLETION_PREFIX = "/_internal/v1/writing/completions/"

ACTIONS = {
    "summary": "提炼摘要，保留重点。",
    "polish": "润色文字，保持原意。",
    "continue": "自然续写，不重复已有内容。",
    "tasks": "提炼可执行的待办清单。",
    "custom": "按用户要求辅助写作。",
}


class WritingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str = Field(min_length=1, max_length=128)
    note_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    revision: int = Field(ge=0)
    action: Literal["summary", "polish", "continue", "tasks", "custom"]
    instruction: str = Field(default="", max_length=4000)
    content: str = Field(max_length=100000)

    def digest(self):
        return hashlib.sha256(
            json.dumps(
                self.model_dump(mode="json"),
                sort_keys=True,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()

    @property
    def path(self):
        return WRITING_COMPLETION_PREFIX + self.note_id + "/" + self.digest()


def writing_target(method, path):
    if method == "GET" and path == WRITING_MODELS_PATH:
        return "/v1/model-inference/options"
    if method == "POST" and re.fullmatch(
        re.escape(WRITING_COMPLETION_PREFIX) + r"[A-Za-z0-9_-]{1,128}/[a-f0-9]{64}", path
    ):
        return "/v1/model-inference/text/stream"
    return None


def writing_grant(grant):
    if grant.caller != "thought" or grant.target_service != "models":
        return False
    if grant.purpose == "thought.writing.list":
        return bool(
            grant.target_method == "GET"
            and grant.target_path == WRITING_MODELS_PATH
            and (
                (
                    grant.source_method == "GET"
                    and grant.source_path == "/v1/thought-workshop/models"
                )
                or (
                    grant.source_method == "POST"
                    and re.fullmatch(
                        r"/v1/thought-workshop/notes/[A-Za-z0-9_-]{1,128}/assistant",
                        grant.source_path,
                    )
                )
            )
        )
    if grant.purpose != "thought.writing.complete" or grant.source_method != "POST":
        return False
    source = re.fullmatch(
        r"/v1/thought-workshop/notes/([A-Za-z0-9_-]{1,128})/assistant", grant.source_path
    )
    target = re.fullmatch(
        re.escape(WRITING_COMPLETION_PREFIX) + r"([A-Za-z0-9_-]{1,128})/[a-f0-9]{64}",
        grant.target_path,
    )
    return bool(source and target and source[1] == target[1] and grant.target_method == "POST")


def event(kind, **payload):
    return ("data: " + json.dumps({"type": kind, **payload}, ensure_ascii=False) + "\n\n").encode()
