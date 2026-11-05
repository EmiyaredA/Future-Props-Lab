from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from time import monotonic
from typing import Any, Literal, Protocol


class ApprovalNotFoundError(Exception):
    pass


class ApprovalConflictError(Exception):
    pass


@dataclass(frozen=True)
class ApprovalResolution:
    decision: Literal["approve", "reject"]
    canvas_revision: int
    authorization: str | None = field(default=None, repr=False)


@dataclass
class PendingApproval:
    run_id: str
    approval_id: str
    scope: dict[str, Any]
    proposal_canvas_revision: int
    expires_at: float
    future: asyncio.Future[ApprovalResolution]


class ApprovalPort(Protocol):
    """Process-local rendezvous; the business owner authorizes and persists decisions.

    Waiters never survive restart. Cancellation and shutdown must wake them without
    treating the action as approved; a replacement may not rebase a proposal's revision.
    """

    async def wait(
        self,
        *,
        run_id: str,
        approval_id: str,
        scope: dict[str, Any],
        proposal_canvas_revision: int,
        timeout_seconds: float,
        on_registered: Callable[[], Awaitable[None]] | None = None,
    ) -> ApprovalResolution: ...

    async def cancel_run(self, run_id: str) -> None: ...


class ApprovalBroker:
    def __init__(self) -> None:
        self._pending: dict[tuple[str, str], PendingApproval] = {}
        self._lock = asyncio.Lock()
        self._closed = False

    async def wait(
        self,
        *,
        run_id: str,
        approval_id: str,
        scope: dict[str, Any],
        proposal_canvas_revision: int,
        timeout_seconds: float,
        on_registered: Callable[[], Awaitable[None]] | None = None,
    ) -> ApprovalResolution:
        loop = asyncio.get_running_loop()
        pending = PendingApproval(
            run_id=run_id,
            approval_id=approval_id,
            scope=dict(scope),
            proposal_canvas_revision=proposal_canvas_revision,
            expires_at=monotonic() + timeout_seconds,
            future=loop.create_future(),
        )
        key = (run_id, approval_id)
        async with self._lock:
            if self._closed:
                raise RuntimeError("审批协调器已关闭")
            if key in self._pending:
                raise ApprovalConflictError("审批请求已存在")
            self._pending[key] = pending
        try:
            async with asyncio.timeout(timeout_seconds):
                if on_registered is not None:
                    await on_registered()
                return await pending.future
        finally:
            async with self._lock:
                self._pending.pop(key, None)

    async def resolve(
        self,
        *,
        run_id: str,
        approval_id: str,
        scope: dict[str, Any],
        decision: Literal["approve", "reject"],
        canvas_revision: int,
        authorization: str | None = None,
    ) -> None:
        del canvas_revision
        async with self._lock:
            pending = self._pending.get((run_id, approval_id))
            if pending is None or monotonic() >= pending.expires_at:
                raise ApprovalNotFoundError("待确认操作不存在或已过期")
            for key, value in scope.items():
                if pending.scope.get(key) != value:
                    raise ApprovalNotFoundError("待确认操作不属于当前项目或对话")
            if pending.future.done():
                raise ApprovalConflictError("待确认操作已经处理")
            pending.future.set_result(
                ApprovalResolution(
                    decision=decision,
                    # Approval never rebases an existing proposal. The submitted
                    # revision is only proof of what the user is currently seeing;
                    # tools must CAS against the revision used to build the proposal.
                    canvas_revision=pending.proposal_canvas_revision,
                    authorization=authorization if decision == "approve" else None,
                )
            )

    async def cancel_run(self, run_id: str) -> None:
        async with self._lock:
            matches = [item for key, item in self._pending.items() if key[0] == run_id]
            for pending in matches:
                if not pending.future.done():
                    pending.future.cancel()

    async def close(self) -> None:
        """Release pending process handles; durable action recovery belongs to its owner."""
        async with self._lock:
            self._closed = True
            for pending in self._pending.values():
                if not pending.future.done():
                    pending.future.cancel()
            self._pending.clear()
