"""Creative source targets are fixed and parse to path-free immutable values."""

from studio.contracts.creative_workshop.creative_integrations import creative_source_target


def test_source_targets_identify_exact_scope_and_reject_extra_paths():
    target = "/_internal/v1/creative-integrations/sources/skill/owned-id"
    parsed = creative_source_target("GET", target)
    assert (parsed.kind, parsed.source_id, parsed.revision, parsed.sha256) == (
        "skill",
        "owned-id",
        None,
        None,
    )
    content = target + "/content/4/" + "a" * 64
    parsed = creative_source_target("GET", content)
    assert (parsed.kind, parsed.source_id, parsed.revision, parsed.sha256) == (
        "skill",
        "owned-id",
        4,
        "a" * 64,
    )
    for path in (target + "/other", target + "/content/4/invalid", target + "?owner=other"):
        assert creative_source_target("GET", path) is None
    assert creative_source_target("POST", target) is None
