"""Validate the current note before sending an explicit request to the model service."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.schemas.workshop import ThoughtAssistantIn, ThoughtModelOut
from app.apps.thought_workshop.writing import WritingModel, WritingModels
from app.llm.credential_snapshot import CredentialSnapshot
from fpl_runtime.writing import ACTIONS

if TYPE_CHECKING:
    from app.apps.thought_workshop.notes import Notes


async def models(writing: WritingModels) -> list[ThoughtModelOut]:
    return await writing.list()


@dataclass(frozen=True)
class PreparedWriting:
    owner_user_id: str
    note_id: str
    revision: int
    model: WritingModel
    action: str
    instruction: str
    content: str
    credential: CredentialSnapshot = field(default_factory=CredentialSnapshot)

    @property
    def action_prompt(self):
        return ACTIONS[self.action]


async def prepare(
    notes: Notes,
    note_id: str,
    body: ThoughtAssistantIn,
    *,
    writing: WritingModels,
    credential: CredentialSnapshot | None = None,
) -> PreparedWriting:
    note = await notes.get(note_id)
    if note.revision != body.expected_revision:
        await notes.conflict(note_id, body.expected_revision)
    if note.deleted_at:
        raise ThoughtError("请先恢复笔记")
    if body.selection and " ".join(body.selection.split()) not in " ".join(
        note.search_text.split()
    ):
        raise ThoughtError("选区已变化，请重新选择")
    content = body.selection or note.search_text
    if len(content) > 100000:
        raise ThoughtError("内容过长，请选择较短的片段")
    if body.action == "custom" and not body.instruction.strip():
        raise ThoughtError("请输入写作要求")
    # Model lookup and streaming are outside the owning note transaction.
    owner, revision = notes.owner_user_id, note.revision
    await notes.session.rollback()
    model = await writing.select(body.model_id)
    return PreparedWriting(
        owner,
        note_id,
        revision,
        model,
        body.action,
        body.instruction,
        content,
        credential or CredentialSnapshot(),
    )


def writing_events(prepared: PreparedWriting, writing: WritingModels):
    return writing.events(prepared)
