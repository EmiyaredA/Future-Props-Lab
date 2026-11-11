"""Account-bound, short database operations for a dialogue turn."""

from studio.contracts.amadeus.conversations import ActionIn, QuestionIn
from studio.runtime.database.operation_receipts import OperationError

from .conversations import Conversations
from .questions import Questions
from .runs import RunRecords


class DialogueRecords:
    def __init__(self, sessions, principal, conversation, run):
        self.sessions, self.principal = sessions, principal
        self.conversation, self.run = conversation, run

    def session(self):
        return self.sessions(info={"owner_user_id": self.principal.user_id})

    async def require_running(self):
        async with self.session() as session:
            row = await RunRecords(session, self.principal).get(self.conversation, self.run)
            if row.status != "running":
                raise OperationError("运行已停止或等待确认", "run_not_active", 409)

    async def ask(self, question: QuestionIn):
        async with self.session() as session:
            return await Questions(session, self.principal).create(
                self.conversation, self.run, question
            )

    async def propose(self, name, arguments):
        async with self.session() as session:
            # pause_for_approval commits the state transition and the proposal together.
            action = await Conversations(session, self.principal).propose(
                self.conversation,
                ActionIn(tool_name=name, arguments=arguments, run_id=self.run),
                commit=False,
            )
            await RunRecords(session, self.principal).pause_for_approval(
                self.conversation, self.run
            )
            return action
