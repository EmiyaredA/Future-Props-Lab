from __future__ import annotations

from collections import deque

from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.core.time import iso_utc, utc_now
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.models import (
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.galgame_workshop import (
    GalgameStoryBranchBlock,
    GalgameStoryChapter,
    GalgameStoryChapterReport,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryEndChapterBlock,
    GalgameStoryProject,
    GalgameStoryReportIssue,
    GalgameStoryRouteReportOut,
)


def default_story_document() -> GalgameStoryProject:
    return GalgameStoryProject.model_validate(
        {
            "schemaVersion": "1.0",
            "synopsis": "",
            "characters": [],
            "scenes": [],
            "variables": [],
            "assets": [],
            "chapters": [
                {
                    "id": "chapter-1",
                    "title": "第一章",
                    "order": 1,
                    "entryFragmentId": "main",
                    "fragments": [{"id": "main", "title": "main", "blocks": []}],
                }
            ],
        }
    )


def normalize_story_document(value: object) -> GalgameStoryProject:
    if not isinstance(value, dict):
        raise GalgameStoryDocumentInvalidError("故事文档格式无效")
    candidate = dict(value)
    if "schemaVersion" not in candidate:
        candidate["schemaVersion"] = "1.0"
        candidate.setdefault("synopsis", "")
        candidate.setdefault("characters", [])
        candidate.setdefault("scenes", [])
        candidate.setdefault("variables", [])
        candidate.setdefault("assets", [])
        if not candidate.get("chapters"):
            candidate["chapters"] = default_story_document().model_dump(mode="json", by_alias=True)[
                "chapters"
            ]
    try:
        return GalgameStoryProject.model_validate(candidate)
    except ValidationError as exc:
        raise GalgameStoryDocumentInvalidError("故事文档不是受支持的 V1 格式") from exc


def story_out(row: GalgameStoryDocument, document: GalgameStoryProject) -> GalgameStoryDocumentOut:
    return GalgameStoryDocumentOut(
        project_id=row.project_id,
        document=document,
        revision=row.revision,
        updated_at=iso_utc(row.updated_at),
    )


def _terminator_index(chapter: GalgameStoryChapter, fragment_id: str) -> int | None:
    fragment = next(item for item in chapter.fragments if item.id == fragment_id)
    for index, block in enumerate(fragment.blocks):
        if isinstance(block, (GalgameStoryBranchBlock, GalgameStoryEndChapterBlock)):
            return index
    return None


def _strong_components(nodes: set[str], edges: dict[str, set[str]]) -> list[list[str]]:
    index = 0
    indices: dict[str, int] = {}
    lowlinks: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    result: list[list[str]] = []

    def visit(node: str) -> None:
        nonlocal index
        indices[node] = index
        lowlinks[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)
        for target in edges.get(node, set()):
            if target not in nodes:
                continue
            if target not in indices:
                visit(target)
                lowlinks[node] = min(lowlinks[node], lowlinks[target])
            elif target in on_stack:
                lowlinks[node] = min(lowlinks[node], indices[target])
        if lowlinks[node] != indices[node]:
            return
        component: list[str] = []
        while stack:
            item = stack.pop()
            on_stack.remove(item)
            component.append(item)
            if item == node:
                break
        if len(component) > 1 or node in edges.get(node, set()):
            result.append(sorted(component))

    for node in sorted(nodes):
        if node not in indices:
            visit(node)
    return result


def build_route_report(
    project_id: str,
    story_revision: int,
    document: GalgameStoryProject,
) -> GalgameStoryRouteReportOut:
    errors: list[GalgameStoryReportIssue] = []
    warnings: list[GalgameStoryReportIssue] = []
    chapter_reports: list[GalgameStoryChapterReport] = []

    for chapter_index, chapter in enumerate(document.chapters):
        fragment_by_id = {fragment.id: fragment for fragment in chapter.fragments}
        fragment_ids = set(fragment_by_id)
        edges: dict[str, set[str]] = {fragment_id: set() for fragment_id in fragment_ids}
        terminal_fragments: set[str] = set()
        ending_by_fragment: dict[str, str] = {}

        if chapter.entry_fragment_id not in fragment_ids:
            errors.append(
                GalgameStoryReportIssue(
                    code="missing_entry",
                    message=f"章节“{chapter.title}”的入口 Fragment 不存在",
                    path=f"/chapters/{chapter_index}/entryFragmentId",
                    chapter_id=chapter.id,
                )
            )

        for fragment_index, fragment in enumerate(chapter.fragments):
            terminator_index = _terminator_index(chapter, fragment.id)
            if terminator_index is None:
                errors.append(
                    GalgameStoryReportIssue(
                        code="open_fragment",
                        message=f"Fragment“{fragment.title}”没有分支或章节结局",
                        path=(f"/chapters/{chapter_index}/fragments/{fragment_index}/blocks"),
                        chapter_id=chapter.id,
                        fragment_id=fragment.id,
                    )
                )
                continue
            terminator = fragment.blocks[terminator_index]
            if terminator_index != len(fragment.blocks) - 1:
                errors.append(
                    GalgameStoryReportIssue(
                        code="dead_blocks",
                        message=f"Fragment“{fragment.title}”在终止 Block 后仍有内容",
                        path=(
                            f"/chapters/{chapter_index}/fragments/{fragment_index}/blocks/"
                            f"{terminator_index + 1}"
                        ),
                        chapter_id=chapter.id,
                        fragment_id=fragment.id,
                        block_id=fragment.blocks[terminator_index + 1].id,
                    )
                )
            if isinstance(terminator, GalgameStoryBranchBlock):
                edges[fragment.id].update(
                    choice.target_fragment_id for choice in terminator.choices
                )
            else:
                terminal_fragments.add(fragment.id)
                ending_by_fragment[fragment.id] = terminator.ending_id

        reachable: set[str] = set()
        if chapter.entry_fragment_id in fragment_ids:
            queue = deque([chapter.entry_fragment_id])
            while queue:
                fragment_id = queue.popleft()
                if fragment_id in reachable:
                    continue
                reachable.add(fragment_id)
                queue.extend(edges.get(fragment_id, set()) - reachable)

        unreachable = sorted(fragment_ids - reachable)
        for fragment_id in unreachable:
            fragment = fragment_by_id[fragment_id]
            errors.append(
                GalgameStoryReportIssue(
                    code="unreachable_fragment",
                    message=f"Fragment“{fragment.title}”无法从章节入口到达",
                    path=(
                        f"/chapters/{chapter_index}/fragments/{chapter.fragments.index(fragment)}"
                    ),
                    chapter_id=chapter.id,
                    fragment_id=fragment.id,
                )
            )

        reachable_endings = sorted(
            ending_by_fragment[fragment_id] for fragment_id in reachable & terminal_fragments
        )
        if reachable and not reachable_endings:
            errors.append(
                GalgameStoryReportIssue(
                    code="no_reachable_ending",
                    message=f"章节“{chapter.title}”没有可达结局",
                    path=f"/chapters/{chapter_index}",
                    chapter_id=chapter.id,
                )
            )

        reverse_edges: dict[str, set[str]] = {node: set() for node in fragment_ids}
        for source, targets in edges.items():
            for target in targets:
                reverse_edges.setdefault(target, set()).add(source)
        can_reach_ending: set[str] = set()
        queue = deque(terminal_fragments)
        while queue:
            node = queue.popleft()
            if node in can_reach_ending:
                continue
            can_reach_ending.add(node)
            queue.extend(reverse_edges.get(node, set()) - can_reach_ending)

        cycles = _strong_components(reachable, edges)
        for cycle in cycles:
            trapped = not any(node in can_reach_ending for node in cycle)
            issue = GalgameStoryReportIssue(
                code="trapped_cycle" if trapped else "cycle",
                message=(
                    "线路存在无法抵达结局的循环"
                    if trapped
                    else "线路存在可以退出的循环，请确认是有意设计"
                ),
                path=f"/chapters/{chapter_index}/fragments",
                chapter_id=chapter.id,
                fragment_id=cycle[0],
            )
            (errors if trapped else warnings).append(issue)

        chapter_reports.append(
            GalgameStoryChapterReport(
                chapter_id=chapter.id,
                reachable_fragment_ids=sorted(reachable),
                unreachable_fragment_ids=unreachable,
                ending_ids=reachable_endings,
                cycles=cycles,
            )
        )

    return GalgameStoryRouteReportOut(
        project_id=project_id,
        story_revision=story_revision,
        ready=not errors,
        errors=errors,
        warnings=warnings,
        chapters=chapter_reports,
    )


class GalgameStoryDocuments:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        project = await self.session.get(GalgameWorkshopProject, project_id)
        if project is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        return project

    async def _row(self, project_id: str) -> GalgameStoryDocument:
        await self._project(project_id)
        row = await self.session.get(GalgameStoryDocument, project_id)
        if row is None:
            raise GalgameStoryDocumentNotFoundError("故事文档不存在")
        return row

    async def get(self, project_id: str) -> GalgameStoryDocumentOut:
        row = await self._row(project_id)
        return story_out(row, normalize_story_document(row.document))

    async def _asset_rows(
        self, project_id: str, document: GalgameStoryProject
    ) -> dict[str, VisualAsset]:
        file_ids = {asset.file_id for asset in document.assets}
        if not file_ids:
            return {}
        rows = (
            (await self.session.execute(select(VisualAsset).where(VisualAsset.id.in_(file_ids))))
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        if set(by_id) != file_ids:
            raise GalgameStoryDocumentInvalidError("故事素材引用的文件不存在")
        image_mime_types = {"image/jpeg", "image/png", "image/webp", "image/avif"}
        audio_mime_types = {
            "audio/mpeg",
            "audio/wav",
            "audio/x-wav",
            "audio/mp4",
            "audio/x-m4a",
            "audio/ogg",
        }
        for asset in document.assets:
            row = by_id[asset.file_id]
            if asset.type == "image" and (
                row.media_kind != "image" or row.mime_type not in image_mime_types
            ):
                raise GalgameStoryDocumentInvalidError("故事图片素材必须引用静态图片")
            if asset.type == "audio" and (
                row.media_kind != "audio" or row.mime_type not in audio_mime_types
            ):
                raise GalgameStoryDocumentInvalidError("故事声音素材必须引用支持的音频文件")
            if row.project_id is not None:
                raise GalgameStoryDocumentInvalidError("不能引用视觉工坊的私有素材")
            if row.galgame_project_id not in {None, project_id}:
                raise GalgameStoryDocumentInvalidError("不能引用其他 Galgame 工程的私有素材")
        return by_id

    async def _sync_asset_references(self, project_id: str, file_ids: set[str]) -> None:
        current = (
            (
                await self.session.execute(
                    select(GalgameProjectAssetReference).where(
                        GalgameProjectAssetReference.project_id == project_id
                    )
                )
            )
            .scalars()
            .all()
        )
        current_ids = {row.asset_id for row in current}
        removed = current_ids - file_ids
        if removed:
            await self.session.execute(
                delete(GalgameProjectAssetReference).where(
                    GalgameProjectAssetReference.project_id == project_id,
                    GalgameProjectAssetReference.asset_id.in_(removed),
                )
            )
        for asset_id in file_ids - current_ids:
            self.session.add(
                GalgameProjectAssetReference(
                    project_id=project_id,
                    asset_id=asset_id,
                )
            )

    async def put(
        self, project_id: str, body: GalgameStoryDocumentPutIn
    ) -> GalgameStoryDocumentOut:
        project = await self._project(project_id)
        await self._row(project_id)
        asset_rows = await self._asset_rows(project_id, body.document)
        now = utc_now()
        result = await self.session.execute(
            update(GalgameStoryDocument)
            .where(
                GalgameStoryDocument.project_id == project_id,
                GalgameStoryDocument.revision == body.expected_revision,
            )
            .values(
                document=body.document.model_dump(mode="json", by_alias=True),
                revision=body.expected_revision + 1,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                current.model_dump(mode="json", by_alias=True),
            )
        if project.status == "completed":
            project.status = "draft"
            project.revision += 1
            project.updated_at = now
        await self._sync_asset_references(project_id, set(asset_rows))
        await self.session.commit()
        return await self.get(project_id)

    async def report(self, project_id: str) -> GalgameStoryRouteReportOut:
        story = await self.get(project_id)
        report = build_route_report(project_id, story.revision, story.document)
        try:
            rows = await self._asset_rows(project_id, story.document)
        except GalgameStoryDocumentInvalidError as exc:
            issue = GalgameStoryReportIssue(
                code="invalid_asset_reference",
                message=str(exc),
                path="/assets",
            )
            return report.model_copy(update={"ready": False, "errors": [*report.errors, issue]})
        root = get_settings().visual_asset_path
        missing = [
            asset
            for asset in story.document.assets
            if not (root / rows[asset.file_id].storage_key).is_file()
        ]
        if not missing:
            return report
        errors = [
            *report.errors,
            *[
                GalgameStoryReportIssue(
                    code="missing_asset_file",
                    message="故事素材文件不存在",
                    path=f"/assets/{story.document.assets.index(asset)}",
                )
                for asset in missing
            ],
        ]
        return report.model_copy(update={"ready": False, "errors": errors})
