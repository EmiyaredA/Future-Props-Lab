"""Idempotent revision checks; applications own transformation and atomic storage."""

from collections.abc import Callable
from typing import Protocol, TypeVar

from studio.runtime.revisions import RevisionConflictError


class RevisionedSnapshot(Protocol):
    revision: int


class RevisionedCommand(Protocol):
    expected_revision: int


Snapshot = TypeVar("Snapshot", bound=RevisionedSnapshot)
Command = TypeVar("Command", bound=RevisionedCommand)
Candidate = TypeVar("Candidate")


class RevisionedEdits(Protocol[Snapshot, Command, Candidate]):
    """Commit atomically stores CAS and the exact receipt, including on retry.

    Storage rechecks receipts after a concurrent CAS loss and rolls back on
    failure or cancellation. Resource access is checked before any replay.
    """

    async def load(self, resource: str) -> Snapshot: ...
    async def replay(self, resource: str, command: Command) -> Snapshot | None: ...
    async def commit(self, resource: str, command: Command, candidate: Candidate) -> Snapshot: ...


async def apply_revisioned_command(
    store: RevisionedEdits[Snapshot, Command, Candidate],
    resource: str,
    command: Command,
    *,
    transform: Callable[[Snapshot, Command], Candidate],
    describe: Callable[[Snapshot], dict],
) -> Snapshot:
    current = await store.load(resource)
    saved = await store.replay(resource, command)
    if saved is not None:
        return saved
    if current.revision != command.expected_revision:
        raise RevisionConflictError(command.expected_revision, current.revision, describe(current))
    return await store.commit(resource, command, transform(current, command))
