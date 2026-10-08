"""Evidence provenance and resumable-record checks for the research skill."""

import importlib.util
import json
from copy import deepcopy
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/future-props-lab-automation/skills/thought-workshop/research-to-document"
SPEC = importlib.util.spec_from_file_location("research_check", SKILL / "scripts/check_project.py")
assert SPEC and SPEC.loader
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def project():
    record = json.loads((SKILL / "assets/project.json").read_text())
    record["stage"] = "complete"
    record["questions"] = [
        {
            "id": "Q1",
            "text": "Can the documented API export content?",
            "priority": "critical",
            "status": "answered",
            "claim_ids": ["C1"],
            "next_action": "",
        }
    ]
    record["sources"] = [
        {
            "id": "S1",
            "title": "Fixture document",
            "url": "https://example.test/docs",
            "kind": "official",
            "publisher": "Fixture",
            "independence_group": "fixture",
            "status": "inspected",
            "accessed_at": "2026-10-08T10:00:00+08:00",
        }
    ]
    record["evidence"] = [
        {
            "id": "E1",
            "source_id": "S1",
            "question_ids": ["Q1"],
            "locator": "Section 2",
            "summary": "The fixture documents an export endpoint.",
            "basis": "documented",
            "conditions": "Fixture API version 1",
            "artifact": None,
        }
    ]
    record["claims"] = [
        {
            "id": "C1",
            "text": "The fixture documents export.",
            "kind": "fact",
            "status": "verified",
            "question_ids": ["Q1"],
            "evidence_ids": ["E1"],
            "counter_evidence_ids": [],
            "limitations": "Documented, not exercised.",
        }
    ]
    record["checkpoints"] = [
        {
            "id": "P1",
            "at": "2026-10-08T10:10:00+08:00",
            "stage": "complete",
            "summary": "Document checked.",
            "next_action": "Test API when requested.",
            "open_question_ids": [],
        }
    ]
    return record


def test_linked_documented_claim_is_valid_without_claiming_execution():
    assert CHECK.validate(project(), final=True) == []


def test_search_metadata_cannot_be_used_as_evidence():
    record = project()
    record["sources"][0]["status"] = "metadata_only"
    assert any("inspected source" in error for error in CHECK.validate(record))


def test_observation_requires_experiment_artifact():
    record = project()
    record["evidence"][0]["basis"] = "observed"
    assert any("artifact" in error for error in CHECK.validate(record))


def test_dangling_claim_reference_is_rejected():
    record = project()
    record["claims"][0]["evidence_ids"] = ["E-missing"]
    assert any("unknown evidence" in error for error in CHECK.validate(record))


def test_completion_can_disclose_unresolved_question():
    record = project()
    record["questions"].append(
        {
            "id": "Q2",
            "text": "Does export retain comments?",
            "priority": "critical",
            "status": "blocked",
            "claim_ids": [],
            "next_action": "Obtain test account.",
        }
    )
    assert any("disclose" in error for error in CHECK.validate(record, final=True))
    record["checkpoints"][-1]["open_question_ids"] = ["Q2"]
    assert CHECK.validate(record, final=True) == []


def test_saved_status_requires_confirmed_destination():
    record = project()
    record["storage"]["status"] = "synced"
    assert any("home_note_id" in error for error in CHECK.validate(record))


def test_invalid_and_duplicate_records_are_reported_without_crashing():
    record = project()
    record["sources"].append(deepcopy(record["sources"][0]))
    record["claims"][0]["evidence_ids"] = [None, {"bad": True}]
    errors = CHECK.validate(record)
    assert any("duplicate id" in error for error in errors)
    assert any("unknown evidence" in error for error in errors)
    assert CHECK.validate([]) == ["project: expected object"]


def test_empty_template_is_draft_only():
    record = json.loads((SKILL / "assets/project.json").read_text())
    assert CHECK.validate(record) == []
    assert CHECK.validate(record, final=True)


@pytest.mark.parametrize("value", [None, {}, [], 1, True])
def test_malformed_nested_fields_produce_errors(value):
    record = project()
    record["evidence"][0]["question_ids"] = value
    record["evidence"][0]["basis"] = value
    record["claims"][0]["question_ids"] = value
    record["claims"][0]["status"] = value
    record["checkpoints"][0]["open_question_ids"] = value
    assert CHECK.validate(record, final=True)


def test_table_templates_follow_native_table_and_view_validation():
    from app.apps.thought_workshop.multitable.schemas import TableSpec
    from app.apps.thought_workshop.multitable.validation import validate_table

    templates = json.loads((SKILL / "assets/ledger-tables.json").read_text())
    assert len({table["id"] for table in templates}) == len(templates)
    for template in templates:
        table = TableSpec.model_validate(template)
        validate_table(table)
        assert min(table.fields, key=lambda field: field.position).type == "text"


def test_template_views_use_select_status_for_kanban_and_real_filters():
    templates = json.loads((SKILL / "assets/ledger-tables.json").read_text())
    views = [view for table in templates for view in table["views"]]
    assert any(view["type"] == "kanban" for view in views)
    assert any(view["config"].get("filters") for view in views)
    for table in templates:
        fields = {field["id"]: field for field in table["fields"]}
        for view in table["views"]:
            if view["type"] == "kanban":
                assert fields[view["config"]["stack_field_id"]]["type"] == "single"
