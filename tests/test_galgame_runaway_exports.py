from __future__ import annotations

import random

from scripts.galgame_runaway_exports import (
    FULL_DURATION_MS,
    SAMPLE_DURATION_MS,
    random_sample,
    requested_exports,
)


def test_default_export_is_one_random_three_minute_clip() -> None:
    requested = requested_exports(None, random.Random(42))
    assert len(requested) == 1
    sample = requested[0]
    assert sample is not None
    name, start_ms, end_ms = sample
    assert name.startswith("random-3m-")
    assert start_ms % 1_000 == 0
    assert end_ms - start_ms == SAMPLE_DURATION_MS
    assert 0 <= start_ms < end_ms <= FULL_DURATION_MS


def test_full_export_requires_explicit_option() -> None:
    assert requested_exports("full") == [None]
    assert requested_exports("random-sample", random.Random(7))[0] is not None


def test_seeded_random_sample_is_reproducible() -> None:
    assert random_sample(random.Random(5)) == random_sample(random.Random(5))
