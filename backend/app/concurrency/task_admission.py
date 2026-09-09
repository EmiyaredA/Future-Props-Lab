"""Transaction hook supplied by the caller to persist accepted-task ownership."""

from collections.abc import Awaitable, Callable

TaskAdmission = Callable[[list[str]], Awaitable[None]]
