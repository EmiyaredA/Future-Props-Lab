"""Attempt windows are isolated per application and expire without wall-clock sleeps."""

from studio.runtime.http.rate_limit import AttemptLimiter


def test_attempt_windows_expire_and_success_clears_only_requested_keys():
    now = [0.0]
    limiter = AttemptLimiter(window_seconds=300, clock=lambda: now[0])
    assert limiter.allow("login:owner", 1)
    assert not limiter.allow("login:owner", 1)
    assert limiter.allow("login:other", 1)
    limiter.clear("login:owner")
    assert limiter.allow("login:owner", 1)
    assert not limiter.allow("login:other", 1)
    now[0] = 300.0
    assert limiter.allow("login:other", 1)


def test_application_attempt_history_does_not_leak_to_another_instance():
    first = AttemptLimiter()
    second = AttemptLimiter()
    assert first.allow("login:owner", 1)
    assert not first.allow("login:owner", 1)
    assert second.allow("login:owner", 1)
    second.clear("login:owner")
    assert not first.allow("login:owner", 1)
