"""Pure Story reachability, branching and progress diagnostics."""

from __future__ import annotations

from collections import deque

from app.apps.galgame_workshop.schemas import (
    GalgameStoryBranchBlock,
    GalgameStoryCallFragmentBlock,
    GalgameStoryChapter,
    GalgameStoryChapterReport,
    GalgameStoryDialogueBlock,
    GalgameStoryEndChapterBlock,
    GalgameStoryIfBlock,
    GalgameStoryParagraphParamsBlock,
    GalgameStoryProject,
    GalgameStoryReportIssue,
    GalgameStoryRouteReportOut,
)

from .story_flow import STORY_TERMINATOR_TYPES


def _terminator_index(chapter: GalgameStoryChapter, fragment_id: str) -> int | None:
    fragment = next(item for item in chapter.fragments if item.id == fragment_id)
    for index, block in enumerate(fragment.blocks):
        if block.type in STORY_TERMINATOR_TYPES:
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
    ordered_chapters = sorted(document.chapters, key=lambda item: item.order)
    enabled_chapters = [chapter for chapter in ordered_chapters if not chapter.disabled]
    entry_index = next(
        index
        for index, chapter in enumerate(enabled_chapters)
        if chapter.id == document.entry_chapter_id
    )
    reachable_chapter_ids: set[str] = {document.entry_chapter_id}
    can_advance_to_next = True
    final_stop_reachable = False
    characters_by_id = {character.id: character for character in document.characters}
    paragraph_style_ids = {style.id for style in document.presentation.paragraph.custom_styles}
    message_style_ids = {style.id for style in document.presentation.system_message.custom_styles}
    for path, reference, known_project_ids, label in (
        (
            "/presentation/paragraph/defaultStyleRef",
            document.presentation.paragraph.default_style_ref,
            paragraph_style_ids,
            "段落样式",
        ),
        (
            "/presentation/systemMessage/binding",
            document.presentation.system_message.binding,
            message_style_ids,
            "系统消息槽位",
        ),
    ):
        unavailable = reference.source == "extension" or (
            reference.source == "project" and reference.id not in known_project_ids
        )
        if unavailable:
            warnings.append(
                GalgameStoryReportIssue(
                    code="unavailable_style_source",
                    message=f"{label}来源当前不可用，运行时会回退到内置样式",
                    path=path,
                )
            )

    for chapter_index, chapter in enumerate(document.chapters):
        fragment_by_id = {fragment.id: fragment for fragment in chapter.fragments}
        fragment_ids = set(fragment_by_id)
        edges: dict[str, set[str]] = {fragment_id: set() for fragment_id in fragment_ids}
        call_edges: dict[str, set[str]] = {fragment_id: set() for fragment_id in fragment_ids}
        ending_by_fragment: dict[str, str] = {}
        terminal_fragments: set[str] = set()
        natural_fragments: set[str] = set()

        if chapter.disabled:
            warnings.append(
                GalgameStoryReportIssue(
                    code="disabled_chapter",
                    message=f"章节“{chapter.title}”已禁用，试玩时会跳过",
                    path=f"/chapters/{chapter_index}/disabled",
                    chapter_id=chapter.id,
                )
            )

        for fragment_index, fragment in enumerate(chapter.fragments):
            terminator_index = _terminator_index(chapter, fragment.id)
            visible_blocks = (
                fragment.blocks
                if terminator_index is None
                else fragment.blocks[: terminator_index + 1]
            )
            for block_index, block in enumerate(visible_blocks):
                block_path = (
                    f"/chapters/{chapter_index}/fragments/{fragment_index}/blocks/{block_index}"
                )
                if isinstance(block, GalgameStoryDialogueBlock):
                    character = characters_by_id.get(block.character_id)
                    if character is not None:
                        display_name_ids = {item.id for item in character.display_names}
                        skin_ids = {item.id for item in character.portrait_skins}
                        if (
                            block.display_name_id is not None
                            and block.display_name_id not in display_name_ids
                        ):
                            warnings.append(
                                GalgameStoryReportIssue(
                                    code="missing_display_name",
                                    message="对白显示名方案已失效，将回退角色本名",
                                    path=f"{block_path}/displayNameId",
                                    chapter_id=chapter.id,
                                    fragment_id=fragment.id,
                                    block_id=block.id,
                                )
                            )
                        if (
                            block.portrait is not None
                            and block.portrait.skin_id is not None
                            and block.portrait.skin_id not in skin_ids
                        ):
                            warnings.append(
                                GalgameStoryReportIssue(
                                    code="missing_portrait_skin",
                                    message="对白立绘皮肤已失效，将回退默认立绘",
                                    path=f"{block_path}/portrait/skinId",
                                    chapter_id=chapter.id,
                                    fragment_id=fragment.id,
                                    block_id=block.id,
                                )
                            )
                elif isinstance(block, GalgameStoryParagraphParamsBlock):
                    reference = block.style_ref
                    if reference is not None and (
                        reference.source == "extension"
                        or (
                            reference.source == "project"
                            and reference.id not in paragraph_style_ids
                        )
                    ):
                        warnings.append(
                            GalgameStoryReportIssue(
                                code="unavailable_paragraph_style",
                                message="段落参数引用的样式不可用，将回退内置样式",
                                path=f"{block_path}/styleRef",
                                chapter_id=chapter.id,
                                fragment_id=fragment.id,
                                block_id=block.id,
                            )
                        )
                targets: set[str] = set()
                if isinstance(block, GalgameStoryBranchBlock):
                    targets.update(choice.target_fragment_id for choice in block.choices)
                elif isinstance(block, GalgameStoryIfBlock):
                    targets.add(block.then_fragment_id)
                    if block.else_fragment_id is not None:
                        targets.add(block.else_fragment_id)
                elif isinstance(block, GalgameStoryCallFragmentBlock):
                    targets.add(block.target_fragment_id)
                edges[fragment.id].update(targets)
                if isinstance(
                    block,
                    (GalgameStoryBranchBlock, GalgameStoryIfBlock, GalgameStoryCallFragmentBlock),
                ):
                    call_edges[fragment.id].update(targets)
            if terminator_index is None:
                natural_fragments.add(fragment.id)
                continue
            terminator = fragment.blocks[terminator_index]
            if terminator_index < len(fragment.blocks) - 1:
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
            if isinstance(terminator, GalgameStoryEndChapterBlock):
                terminal_fragments.add(fragment.id)
                ending_by_fragment[fragment.id] = terminator.ending_id or chapter.id

        reachable: set[str] = set()
        if chapter.id in reachable_chapter_ids:
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
            (warnings if chapter.disabled else errors).append(
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
        cycles = _strong_components(reachable, call_edges)
        for cycle in cycles:
            trapped = all(
                fragment_by_id[node].blocks
                and isinstance(
                    fragment_by_id[node].blocks[-1],
                    (GalgameStoryBranchBlock, GalgameStoryIfBlock, GalgameStoryCallFragmentBlock),
                )
                and not (call_edges.get(node, set()) - set(cycle))
                for node in cycle
            )
            issue = GalgameStoryReportIssue(
                code="trapped_cycle" if trapped else "cycle",
                message=(
                    "Fragment 递归调用没有可达出口"
                    if trapped
                    else "线路包含可以退出的递归调用，请确认是有意设计"
                ),
                path=f"/chapters/{chapter_index}/fragments",
                chapter_id=chapter.id,
                fragment_id=cycle[0],
            )
            (errors if trapped else warnings).append(issue)

        if chapter.id in reachable_chapter_ids and not chapter.disabled:
            enabled_position = enabled_chapters.index(chapter)
            has_end = bool(reachable & terminal_fragments)
            has_natural_stop = bool(reachable & natural_fragments)
            if enabled_position + 1 < len(enabled_chapters):
                if has_end:
                    reachable_chapter_ids.add(enabled_chapters[enabled_position + 1].id)
                elif chapter.id == document.entry_chapter_id or can_advance_to_next:
                    warnings.append(
                        GalgameStoryReportIssue(
                            code="chapter_stops_before_next",
                            message=f"章节“{chapter.title}”会自然停止，不会进入下一章",
                            path=f"/chapters/{chapter_index}",
                            chapter_id=chapter.id,
                        )
                    )
                    can_advance_to_next = False
            elif has_end or has_natural_stop:
                final_stop_reachable = True

        chapter_reports.append(
            GalgameStoryChapterReport(
                chapter_id=chapter.id,
                reachable_fragment_ids=sorted(reachable),
                unreachable_fragment_ids=unreachable,
                ending_ids=reachable_endings,
                cycles=cycles,
            )
        )

    for chapter in enabled_chapters[entry_index:]:
        if chapter.id not in reachable_chapter_ids:
            errors.append(
                GalgameStoryReportIssue(
                    code="unreachable_chapter",
                    message=f"章节“{chapter.title}”无法从入口章到达",
                    path=f"/chapters/{document.chapters.index(chapter)}",
                    chapter_id=chapter.id,
                )
            )
    if not final_stop_reachable:
        errors.append(
            GalgameStoryReportIssue(
                code="no_reachable_final_stop",
                message="故事没有可达的最终停止点",
                path="/chapters",
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
