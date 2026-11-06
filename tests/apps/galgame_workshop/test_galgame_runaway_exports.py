from __future__ import annotations

import random

from scripts.demo.galgame_runaway.exports import (
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
    assert [item[0] for item in requested_exports("preview-regression") if item] == [
        "diagnostic-two-actors-47s-52s",
        "diagnostic-phone-dialogue-65s-82s",
        "diagnostic-long-subtitle-168s-173s",
        "diagnostic-cg-entry-338s-347s",
        "diagnostic-no-duplicate-1518s-1527s",
        "diagnostic-finale-cg-1761s-1780s",
    ]
    assert requested_exports("scene-time") == [
        ("scene-main-day-switch-145s-160s", 145_000, 160_000),
        ("scene-day-to-evening-964s-980s", 964_000, 980_000),
        ("scene-evening-main-1182s-1198s", 1_182_000, 1_198_000),
        ("scene-evening-to-night-1294s-1310s", 1_294_000, 1_310_000),
    ]
    assert [item[0] for item in requested_exports("expression-sync") if item] == [
        "diagnostic-expression-sync-151s-161s",
        "diagnostic-mother-identity-v4-786s-802s",
        "diagnostic-luka-speaker-1649s-1656s",
    ]
    assert requested_exports("speaker-fix") == [
        ("diagnostic-luka-speaker-fix-526s-539s", 526_000, 539_000)
    ]
    assert [item[0] for item in requested_exports("portrait-review") if item] == [
        "portrait-faris-private-38s-43s",
        "portrait-kurisu-mayuri-shy-219s-233s",
        "portrait-luka-private-283s-291s",
        "portrait-moeka-299s-309s",
        "portrait-suzuha-kagari-1353s-1362s",
        "portrait-maho-suzuha-1596s-1612s",
    ]
    assert [item[0] for item in requested_exports("final-cgs") if item] == [
        "final-cg-01-cleaning-night",
        "final-cg-02-rooftop-finale",
        "final-cg-03-kagari-imitation",
        "final-cg-04-suzuha-entrance",
        "final-cg-05-kagari-remembers",
        "final-cg-06-storytime",
        "final-cg-07-cleaning-evening",
        "final-cg-08-kagari-rejects",
        "final-cg-09-suzuha-maho",
        "final-cg-10-time-machine",
        "final-cg-11a-lab-reaction",
    ]


def test_seeded_random_sample_is_reproducible() -> None:
    assert random_sample(random.Random(5)) == random_sample(random.Random(5))
