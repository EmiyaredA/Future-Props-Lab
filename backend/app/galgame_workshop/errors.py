from __future__ import annotations

from app.schemas.galgame_workshop import GalgameStoryRouteReportOut


class GalgameWorkshopProjectNotFoundError(Exception):
    pass


class GalgameStoryDocumentNotFoundError(Exception):
    pass


class GalgameStoryDocumentInvalidError(Exception):
    pass


class GalgameStoryNotReadyError(Exception):
    def __init__(self, report: GalgameStoryRouteReportOut) -> None:
        super().__init__("故事线路尚未通过工程检查")
        self.report = report
