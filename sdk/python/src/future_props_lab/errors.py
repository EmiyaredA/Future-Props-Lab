"""Protocol errors retain actionable server details without retaining request secrets."""

from typing import Any


class ApiError(Exception):
    def __init__(self, status: int, problem: Any):
        self.status = status
        self.problem = problem if isinstance(problem, dict) else {"detail": problem}
        detail = self.problem.get("detail")
        nested = detail if isinstance(detail, dict) else {}
        self.code = self.problem.get("code") or nested.get("code") or "request_failed"
        self.current = self.problem.get("current", nested.get("current"))
        self.errors = self.problem.get("errors", nested.get("errors", detail))
        message = self.problem.get("message") or nested.get("message")
        super().__init__(message or (detail if isinstance(detail, str) else self.code))


class RevisionConflict(ApiError):
    pass


class TaskFailed(Exception):
    def __init__(self, task: Any):
        self.task = task
        super().__init__(f"Task {getattr(task, 'id', '')} did not complete successfully")


class TaskTimeout(TimeoutError):
    def __init__(self, task_id: str):
        self.task_id = task_id
        super().__init__(f"Stopped waiting for task {task_id}; the server task was not cancelled")
