"""Durable, single-question handoffs from an Amadeus run to its owner."""

from __future__ import annotations

from sqlalchemy import select, update

from app.console.amadeus.models import AmadeusQuestion, AmadeusRun
from app.console.amadeus.runs import Runs
from app.console.amadeus.schemas import QuestionAnswerIn, QuestionIn, QuestionOut
from app.runtime.operation_receipts import OperationError
from app.runtime.time import utc_now


def _out(row: AmadeusQuestion) -> QuestionOut:
    return QuestionOut(
        id=row.id,
        run_id=row.run_id,
        tool_call_id=row.tool_call_id,
        prompt=row.prompt,
        options=row.options_json,
        allow_text=row.allow_text,
        status=row.status,
        answer=row.answer_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class Questions:
    def __init__(self, session, principal):
        self.session, self.principal = session, principal

    async def create(self, conversation_id: str, run_id: str, body: QuestionIn) -> QuestionOut:
        run = await self.session.scalar(
            select(AmadeusRun).where(
                AmadeusRun.id == run_id,
                AmadeusRun.conversation_id == conversation_id,
                AmadeusRun.owner_user_id == self.principal.owner_user_id,
                AmadeusRun.user_id == self.principal.user_id,
                AmadeusRun.status == "running",
            )
        )
        if run is None:
            raise OperationError("运行不存在或已经结束", "run_not_active", 409)
        if not body.options and not body.allow_text:
            raise OperationError("提问必须允许回答", "invalid_question", 422)
        options = [item.strip() for item in body.options]
        if any(not item or len(item) > 120 for item in options) or len(set(options)) != len(
            options
        ):
            raise OperationError("选项无效", "invalid_question", 422)
        row = AmadeusQuestion(
            conversation_id=conversation_id,
            run_id=run_id,
            owner_user_id=self.principal.owner_user_id,
            user_id=self.principal.user_id,
            tool_call_id=body.tool_call_id,
            prompt=body.prompt.strip(),
            options_json=options,
            allow_text=body.allow_text,
            status="pending",
        )
        self.session.add(row)
        now = utc_now()
        run.status = "waiting_question"
        run.active_owner_key = None
        run.finished_at = run.updated_at = now
        await Runs(self.session, self.principal)._save_partial(run)
        await self.session.commit()
        return _out(row)

    async def answer(
        self, conversation_id: str, question_id: str, body: QuestionAnswerIn
    ) -> QuestionOut:
        row = await self.session.scalar(
            select(AmadeusQuestion).where(
                AmadeusQuestion.id == question_id,
                AmadeusQuestion.conversation_id == conversation_id,
                AmadeusQuestion.owner_user_id == self.principal.owner_user_id,
                AmadeusQuestion.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("提问不存在", "not_found", 404)
        answer = body.answer.strip()
        if (row.options_json and answer not in row.options_json and not row.allow_text) or (
            not row.options_json and not row.allow_text
        ):
            raise OperationError("答案不在可选范围", "invalid_answer", 422)
        changed = await self.session.execute(
            update(AmadeusQuestion)
            .where(AmadeusQuestion.id == row.id, AmadeusQuestion.status == "pending")
            .values(
                status="answered",
                answer_json={"answer": answer, "note": body.note.strip()},
                updated_at=utc_now(),
            )
        )
        if changed.rowcount != 1:
            await self.session.rollback()
            raise OperationError("提问已经回答", "question_conflict", 409)
        await self.session.commit()
        await self.session.refresh(row)
        return _out(row)
