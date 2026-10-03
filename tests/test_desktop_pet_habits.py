"""Old documents receive locomotion defaults without mutating the source JSON."""

import copy

import pytest
from pydantic import ValidationError

from app.apps.desktop_pet.schemas import PetConfig, PetHabits


def test_old_habits_default_new_motion_capabilities_without_writeback():
    old = {"schemaVersion": 2, "habits": {"size": 220, "roam": "calm"}}
    preserved = copy.deepcopy(old)
    parsed = PetConfig.model_validate(old)
    assert parsed.habits.edge_climbing is True
    assert parsed.habits.high_gliding is True
    assert old == preserved
    assert "edgeClimbing" not in old["habits"]
    assert parsed.model_dump(by_alias=True)["habits"]["highGliding"] is True


def test_motion_toggles_roundtrip_and_do_not_change_roaming_strength():
    parsed = PetHabits.model_validate({"roam": "off", "edgeClimbing": False, "highGliding": False})
    assert parsed.roam == "off"
    assert parsed.edge_climbing is False
    assert parsed.high_gliding is False
    assert PetHabits.model_validate(parsed.model_dump(by_alias=True)) == parsed
    with pytest.raises(ValidationError):
        PetHabits.model_validate({"highGliding": []})
