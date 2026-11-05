"""Final state decisions shared by local execution, worker receipts and recovery."""

from dataclasses import dataclass

ACTIVE = ("running", "waiting_approval", "cancelling")


@dataclass(frozen=True)
class Ending:
    status: str
    error: str | None


def completion(current: str, requested: str, error: str | None = None) -> Ending | None:
    """A late receipt records evidence but never reopens an already ended turn."""
    if current not in ACTIVE:
        return None
    if current == "cancelling":
        return Ending("cancelled", None)
    return Ending("interrupted" if requested == "unknown" else requested, error)


def closed_approvals(items):
    # Execution may already have happened. Expire permission; do not claim rollback.
    replacements = {"executing": "unknown", "pending": "expired", "approved": "expired"}
    return [{**item, "status": replacements.get(item["status"], item["status"])} for item in items]


def closed_inflight(items, active):
    return [
        {**item, "status": "unknown" if item["status"] == active else item["status"]}
        for item in items
    ]
