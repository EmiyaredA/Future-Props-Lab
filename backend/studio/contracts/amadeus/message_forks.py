"""The only project reads that may be delegated by a message fork."""

import re

FORK_PATH = "/v1/amadeus/conversations/{conversation_id}/messages/{message_id}/fork"
FORK_SOURCE = re.compile(
    re.escape(FORK_PATH)
    .replace(r"\{conversation_id\}", "[^/]+")
    .replace(r"\{message_id\}", "[^/]+")
)

PROJECT_READS = {
    "annotation": ("get_project", "project_id"),
    "director": ("get_project", "project_id"),
    "galgame": ("get_project", "project_id"),
    "interview": ("get_interview_room", "room_id"),
    "motion_compositor": ("get_project", "project_id"),
    "presentation": ("get_project", "project_id"),
    "thought": ("knowledge_base", "project_id"),
    "video": ("get_project", "project_id"),
    "visual": ("get_project", "project_id"),
}


def is_fork_read(operation):
    if not operation:
        return False
    entry = PROJECT_READS.get(operation["resource"])
    return entry is not None and operation["method"] == entry[0]
