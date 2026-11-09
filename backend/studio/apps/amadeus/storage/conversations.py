from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from datetime import timedelta

from sqlalchemy import delete, select, tuple_, update
from sqlalchemy.exc import IntegrityError

from studio.apps.amadeus.storage.files import work_root
from studio.apps.amadeus.storage.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusForkReceipt,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
)
from studio.contracts.amadeus.conversations import (
    ActionDecisionIn,
    ActionIn,
    ActionOut,
    ConversationDetailOut,
    ConversationListItemOut,
    ConversationOut,
    ConversationProjectSummary,
    MessageIn,
    MessageOut,
    QuestionOut,
)
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


def action_arguments_sha256(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


def _conversation(row: AmadeusConversation) -> ConversationOut:
    return ConversationOut.model_validate(row, from_attributes=True)


def _project_summaries(contexts: list[dict] | None) -> list[ConversationProjectSummary]:
    projects = {}
    for context in contexts or []:
        resource = context.get("projectResource")
        project_id = context.get("projectId")
        if (
            not isinstance(resource, str)
            or not resource
            or not isinstance(project_id, str)
            or not project_id
        ):
            continue
        title = context.get("title")
        projects[(resource, project_id)] = ConversationProjectSummary(
            resource=resource,
            id=project_id,
            title=title.strip() if isinstance(title, str) and title.strip() else project_id,
        )
    return list(projects.values())


def _message(row: AmadeusMessage) -> MessageOut:
    return MessageOut(
        id=row.id,
        role=row.role,
        content=row.content,
        references=row.references_json,
        run_id=row.run_id,
        status=row.status,
        pinned=row.pinned,
        created_at=row.created_at,
    )


class Conversations:
    def __init__(self, session, principal, *, files_root=None):
        self.session, self.principal = session, principal
        self.files_root = files_root

    async def _get(self, identity: str) -> AmadeusConversation:
        row = await self.session.scalar(
            select(AmadeusConversation).where(
                AmadeusConversation.id == identity,
                AmadeusConversation.owner_user_id == self.principal.owner_user_id,
                AmadeusConversation.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("对话不存在", "not_found", 404)
        return row

    async def list(self) -> list[ConversationListItemOut]:
        latest_run_id = (
            select(AmadeusRun.id)
            .where(
                AmadeusRun.conversation_id == AmadeusConversation.id,
                AmadeusRun.owner_user_id == AmadeusConversation.owner_user_id,
                AmadeusRun.user_id == AmadeusConversation.user_id,
            )
            .order_by(AmadeusRun.created_at.desc(), AmadeusRun.id.desc())
            .limit(1)
            .correlate(AmadeusConversation)
            .scalar_subquery()
        )
        rows = await self.session.execute(
            select(AmadeusConversation, AmadeusRun.context_json, AmadeusRun.status)
            .outerjoin(AmadeusRun, AmadeusRun.id == latest_run_id)
            .where(
                AmadeusConversation.owner_user_id == self.principal.owner_user_id,
                AmadeusConversation.user_id == self.principal.user_id,
            )
            .order_by(AmadeusConversation.updated_at.desc(), AmadeusConversation.id)
        )
        return [
            ConversationListItemOut(
                **_conversation(row).model_dump(),
                projects=_project_summaries(contexts),
                latest_run_status=status,
            )
            for row, contexts, status in rows
        ]

    async def create(self) -> ConversationOut:
        row = AmadeusConversation(
            owner_user_id=self.principal.owner_user_id,
            user_id=self.principal.user_id,
            title="新对话",
        )
        self.session.add(row)
        await self.session.commit()
        return _conversation(row)

    def _messages(self, conversation_id):
        return select(AmadeusMessage).where(
            AmadeusMessage.conversation_id == conversation_id,
            AmadeusMessage.owner_user_id == self.principal.owner_user_id,
        )

    async def _message_anchor(self, conversation_id, message_id):
        message = await self.session.scalar(
            self._messages(conversation_id).where(AmadeusMessage.id == message_id)
        )
        if message is None or message.role not in {"user", "assistant"}:
            raise OperationError("找不到可操作的已保存消息", "not_found", 404)
        return message

    async def pin_message(self, conversation_id, message_id, pinned):
        source = await self._get(conversation_id)
        if source.executor_kind == "legacy-pi":
            raise OperationError("旧内核对话只读", "legacy_readonly", 409)
        message = await self._message_anchor(conversation_id, message_id)
        result = _message(message).model_copy(update={"pinned": pinned})
        changed = await self.session.execute(
            update(AmadeusMessage)
            .where(
                AmadeusMessage.id == message_id,
                AmadeusMessage.conversation_id == conversation_id,
                AmadeusMessage.owner_user_id == self.principal.owner_user_id,
            )
            .values(pinned=pinned)
        )
        if changed.rowcount != 1:
            raise OperationError("找不到可操作的已保存消息", "not_found", 404)
        await self.session.commit()
        return result

    async def _fork_replay(self, receipt, message_id):
        if receipt.message_id != message_id:
            raise OperationError("请求 ID 已用于其他消息", "idempotency_conflict", 409)
        return _conversation(await self._get(receipt.branch_id))

    async def fork_message(self, conversation_id, message_id, request_id, can_read_project):
        source = _conversation(await self._get(conversation_id))
        key = (conversation_id, str(request_id))
        receipt = await self.session.get(AmadeusForkReceipt, key)
        if receipt is not None:
            return await self._fork_replay(receipt, message_id)
        anchor = await self._message_anchor(conversation_id, message_id)
        rows = await self.session.scalars(
            self._messages(conversation_id)
            .where(
                AmadeusMessage.role.in_(("user", "assistant")),
                tuple_(AmadeusMessage.created_at, AmadeusMessage.id)
                <= (anchor.created_at, anchor.id),
            )
            .order_by(AmadeusMessage.created_at, AmadeusMessage.id)
        )
        messages = [_message(row) for row in rows]
        await self.session.rollback()

        projects = {
            (ref.target.project_resource, ref.target.project_id)
            for message in messages
            for ref in message.references
            if ref.target and not ref.target.unsaved
        }
        concurrency = asyncio.Semaphore(4)

        async def check(project):
            async with concurrency:
                return await can_read_project(*project)

        ordered_projects = sorted(projects)
        accessible = {
            project
            for project, allowed in zip(
                ordered_projects,
                await asyncio.gather(*(check(project) for project in ordered_projects)),
                strict=True,
            )
            if allowed
        }

        branch_id = new_id()
        self.session.add(
            AmadeusForkReceipt(
                conversation_id=conversation_id,
                request_id=key[1],
                owner_user_id=self.principal.owner_user_id,
                message_id=message_id,
                branch_id=branch_id,
            )
        )
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            await self._get(conversation_id)
            receipt = await self.session.get(AmadeusForkReceipt, key)
            if receipt is not None:
                return await self._fork_replay(receipt, message_id)
            raise

        branch = AmadeusConversation(
            id=branch_id,
            owner_user_id=self.principal.owner_user_id,
            user_id=self.principal.user_id,
            title=f"{source.title[:115]} · 分叉",
            agent_id=source.agent_id,
            model_id=source.model_id,
        )
        self.session.add(branch)
        await self.session.flush()
        previous_time = None
        for message in messages:
            created_at = message.created_at
            if previous_time is not None and created_at <= previous_time:
                created_at = previous_time + timedelta(microseconds=1)
            previous_time = created_at
            self.session.add(
                AmadeusMessage(
                    owner_user_id=self.principal.owner_user_id,
                    conversation_id=branch_id,
                    role=message.role,
                    content=message.content,
                    created_at=created_at,
                    references_json=[
                        ref.model_dump(mode="json", exclude_none=True)
                        for ref in message.references
                        if ref.target
                        and not ref.target.unsaved
                        and (ref.target.project_resource, ref.target.project_id) in accessible
                    ],
                )
            )
        result = _conversation(branch)
        await self.session.commit()
        return result

    async def detail(self, identity: str) -> ConversationDetailOut:
        row = await self._get(identity)
        messages = (
            await self.session.scalars(
                self._messages(row.id).order_by(AmadeusMessage.created_at, AmadeusMessage.id)
            )
        ).all()
        actions = (
            await self.session.scalars(
                select(AmadeusAction)
                .where(
                    AmadeusAction.conversation_id == row.id,
                    AmadeusAction.owner_user_id == self.principal.owner_user_id,
                    AmadeusAction.user_id == self.principal.user_id,
                )
                .order_by(AmadeusAction.created_at, AmadeusAction.id)
            )
        ).all()
        questions = (
            await self.session.scalars(
                select(AmadeusQuestion)
                .where(
                    AmadeusQuestion.conversation_id == row.id,
                    AmadeusQuestion.owner_user_id == self.principal.owner_user_id,
                    AmadeusQuestion.user_id == self.principal.user_id,
                )
                .order_by(AmadeusQuestion.created_at, AmadeusQuestion.id)
            )
        ).all()
        return ConversationDetailOut(
            conversation=_conversation(row),
            messages=[_message(item) for item in messages],
            actions=[
                ActionOut(
                    id=item.id,
                    tool_name=item.tool_name,
                    arguments=item.arguments_json,
                    arguments_sha256=item.arguments_sha256,
                    status=item.status,
                    result=item.result_json,
                    run_id=item.run_id,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
                for item in actions
            ],
            questions=[
                QuestionOut(
                    id=item.id,
                    run_id=item.run_id,
                    tool_call_id=item.tool_call_id,
                    prompt=item.prompt,
                    options=item.options_json,
                    allow_text=item.allow_text,
                    status=item.status,
                    answer=item.answer_json,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
                for item in questions
            ],
        )

    async def _revision(self, row: AmadeusConversation, expected: int) -> None:
        if row.revision != expected:
            await self._conflict(row.id, expected)

    async def _conflict(self, identity: str, expected: int) -> None:
        await self.session.rollback()
        current = await self._get(identity)
        raise RevisionConflictError(
            expected, current.revision, _conversation(current).model_dump(mode="json")
        )

    async def patch(
        self, identity: str, expected: int, title: str | None, model_id: str | None
    ) -> ConversationOut:
        row = await self._get(identity)
        await self._revision(row, expected)
        values = {"revision": expected + 1, "updated_at": utc_now()}
        if title is not None:
            values["title"] = title.strip()
        if model_id is not None:
            values["model_id"] = model_id
        changed = await self.session.execute(
            update(AmadeusConversation)
            .where(AmadeusConversation.id == identity, AmadeusConversation.revision == expected)
            .values(**values)
        )
        if changed.rowcount != 1:
            await self._conflict(identity, expected)
        await self.session.commit()
        await self.session.refresh(row)
        return _conversation(row)

    async def delete(self, identity: str, expected: int) -> None:
        row = await self._get(identity)
        await self._revision(row, expected)
        running = await self.session.scalar(
            select(AmadeusRun.id).where(
                AmadeusRun.conversation_id == identity,
                AmadeusRun.active_owner_key.is_not(None),
            )
        )
        if running is not None:
            raise OperationError("请先停止正在执行的操作", "action_running", 409)
        if self.files_root is None:
            raise ValueError("Conversation deletion requires explicit file storage")
        folder = work_root(self.principal.owner_user_id, identity, files_root=self.files_root)
        if folder.is_symlink():
            raise OperationError("会话目录不安全", "unsafe_path", 409)
        removed = await self.session.execute(
            delete(AmadeusConversation).where(
                AmadeusConversation.id == identity,
                AmadeusConversation.revision == expected,
            )
        )
        if removed.rowcount != 1:
            await self._conflict(identity, expected)
        await self.session.commit()
        if folder.is_dir():
            await asyncio.to_thread(shutil.rmtree, folder)

    async def add_message(self, identity: str, body: MessageIn) -> ConversationDetailOut:
        row = await self._get(identity)
        if row.executor_kind == "legacy-pi":
            raise OperationError("旧内核对话只读，请新建 Code Agent 对话", "legacy_readonly", 409)
        await self._revision(row, body.expected_revision)
        values = {"revision": body.expected_revision + 1, "updated_at": utc_now()}
        if row.title == "新对话" and body.role == "user":
            values["title"] = body.content[:48].replace("\n", " ")
        changed = await self.session.execute(
            update(AmadeusConversation)
            .where(
                AmadeusConversation.id == identity,
                AmadeusConversation.revision == body.expected_revision,
            )
            .values(**values)
        )
        if changed.rowcount != 1:
            await self._conflict(identity, body.expected_revision)
        self.session.add(
            AmadeusMessage(
                conversation_id=row.id,
                owner_user_id=self.principal.owner_user_id,
                role=body.role,
                content=body.content,
                references_json=[
                    item.model_dump(mode="json", exclude_none=True) for item in body.references
                ],
            )
        )
        await self.session.commit()
        return await self.detail(identity)

    async def propose(self, identity: str, body: ActionIn, *, commit=True) -> ActionOut:
        await self._get(identity)
        if body.run_id:
            run = await self.session.scalar(
                select(AmadeusRun).where(
                    AmadeusRun.id == body.run_id,
                    AmadeusRun.conversation_id == identity,
                    AmadeusRun.owner_user_id == self.principal.owner_user_id,
                    AmadeusRun.user_id == self.principal.user_id,
                    AmadeusRun.status == "running",
                    AmadeusRun.mode == "agent",
                )
            )
            if run is None:
                raise OperationError("运行不存在或已经结束", "run_not_active", 409)
        row = AmadeusAction(
            conversation_id=identity,
            owner_user_id=self.principal.owner_user_id,
            user_id=self.principal.user_id,
            tool_name=body.tool_name,
            arguments_json=body.arguments,
            arguments_sha256=action_arguments_sha256(body.arguments),
            status="pending",
            run_id=body.run_id,
        )
        self.session.add(row)
        if commit:
            await self.session.commit()
        else:
            await self.session.flush()
        return ActionOut(
            id=row.id,
            tool_name=row.tool_name,
            arguments=row.arguments_json,
            arguments_sha256=row.arguments_sha256,
            status=row.status,
            result=row.result_json,
            run_id=row.run_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def decide(self, identity: str, action_id: str, body: ActionDecisionIn) -> ActionOut:
        await self._get(identity)
        row = await self.session.scalar(
            select(AmadeusAction).where(
                AmadeusAction.id == action_id,
                AmadeusAction.conversation_id == identity,
                AmadeusAction.owner_user_id == self.principal.owner_user_id,
                AmadeusAction.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("操作不存在", "not_found", 404)
        if row.run_id:
            active = await self.session.scalar(
                select(AmadeusRun.id).where(
                    AmadeusRun.id == row.run_id,
                    AmadeusRun.status.in_(("running", "waiting_approval")),
                )
            )
            if active is None:
                raise OperationError("运行已经结束，审批已失效", "run_not_active", 409)
        changed = await self.session.execute(
            update(AmadeusAction)
            .where(
                AmadeusAction.id == action_id,
                AmadeusAction.status == "pending",
                AmadeusAction.arguments_sha256 == body.arguments_sha256,
            )
            .values(
                status="approved" if body.approve else "rejected",
                updated_at=utc_now(),
            )
        )
        if changed.rowcount != 1:
            await self.session.rollback()
            raise OperationError("操作已变更或已处理", "approval_conflict", 409)
        await self.session.commit()
        await self.session.refresh(row)
        return ActionOut(
            id=row.id,
            tool_name=row.tool_name,
            arguments=row.arguments_json,
            arguments_sha256=row.arguments_sha256,
            status=row.status,
            result=row.result_json,
            run_id=row.run_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
