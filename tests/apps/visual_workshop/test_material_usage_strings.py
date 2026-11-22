"""Frozen reference discovery includes IDs inside keys and serialized prompts."""

from studio.apps.visual_workshop.storage.material_usage import strings


def test_nested_asset_keys_and_embedded_ids_are_frozen_without_returning_prompt_text():
    identity = "b6fde877-983b-4147-bfd0-9a3da54a82fa"
    value = {
        "prompt": f"Reference [{identity}]",
        "subjects": {f"asset:{identity}": "主体1"},
        "nested": [None, 3],
    }
    assert strings(value) == {identity}
