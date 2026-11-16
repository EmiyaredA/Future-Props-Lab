"""Capacity decisions consume aggregate facts, independent of task tables."""

from dataclasses import dataclass

from studio.contracts.identity.errors import AccountError
from studio.contracts.model_service.schemas.runtime_quotas import RuntimeQuotas


@dataclass(frozen=True)
class CapacityUsage:
    total: int
    own: int
    voices: int
    own_voices: int


def require_capacity(policy: RuntimeQuotas, role: str, usage: CapacityUsage, *, voice, weight):
    limit = getattr(policy, role)
    ceiling = policy.instance.total - (policy.reserved_for_admins if role == "user" else 0)
    if (
        usage.total + weight > ceiling
        or usage.own + weight > limit.total
        or (
            voice
            and (
                usage.voices + weight > policy.instance.realtime_voice
                or usage.own_voices + weight > limit.realtime_voice
            )
        )
    ):
        raise AccountError("runtime_quota_exceeded")
