from __future__ import annotations

from pydantic import BaseModel


class GalgameStoryReportIssue(BaseModel):
    code: str
    message: str
    path: str
    chapter_id: str | None = None
    fragment_id: str | None = None
    block_id: str | None = None


class GalgameStoryChapterReport(BaseModel):
    chapter_id: str
    reachable_fragment_ids: list[str]
    unreachable_fragment_ids: list[str]
    ending_ids: list[str]
    cycles: list[list[str]]


class GalgameStoryRouteReportOut(BaseModel):
    project_id: str
    story_revision: int
    ready: bool
    errors: list[GalgameStoryReportIssue]
    warnings: list[GalgameStoryReportIssue]
    chapters: list[GalgameStoryChapterReport]
