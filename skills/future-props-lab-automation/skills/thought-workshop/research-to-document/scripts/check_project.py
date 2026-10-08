#!/usr/bin/env python3
"""Read-only structural and evidence-link validation; never verifies source truth."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

STAGES = {"scoping", "collecting", "validating", "drafting", "reviewing", "complete", "paused"}


def validate(project: object, *, final: bool = False) -> list[str]:
    errors: list[str] = []

    def fail(path: str, message: str) -> None:
        errors.append(f"{path}: {message}")

    def string(value: object, path: str) -> None:
        if not isinstance(value, str) or not value.strip():
            fail(path, "expected nonempty string")

    def choice(value: object, options: set[str], path: str) -> None:
        if not isinstance(value, str) or value not in options:
            fail(path, f"expected one of {', '.join(sorted(options))}")

    def timestamp(value: object, path: str, *, nullable: bool = False) -> None:
        if value is None and nullable:
            return
        try:
            parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
            if parsed is None or parsed.utcoffset() is None:
                raise ValueError
        except ValueError:
            fail(path, "expected ISO 8601 timestamp with timezone")

    if not isinstance(project, dict):
        return ["project: expected object"]
    if type(project.get("schema_version")) is not int or project["schema_version"] != 1:
        fail("schema_version", "expected 1")
    for field in ("id", "title", "brief"):
        string(project.get(field), field)
    choice(project.get("mode"), {"product", "technical"}, "mode")
    choice(project.get("stage"), STAGES, "stage")
    timestamp(project.get("updated_at"), "updated_at")

    indexes: dict[str, dict[str, dict]] = {}
    for collection in ("questions", "sources", "evidence", "claims", "checkpoints"):
        items = project.get(collection)
        indexes[collection] = {}
        if not isinstance(items, list):
            fail(collection, "expected array")
            continue
        for position, item in enumerate(items):
            path = f"{collection}[{position}]"
            if not isinstance(item, dict):
                fail(path, "expected object")
                continue
            item_id = item.get("id")
            string(item_id, f"{path}.id")
            if not isinstance(item_id, str) or not item_id.strip():
                continue
            if item_id in indexes[collection]:
                fail(path, f"duplicate id {item_id}")
            indexes[collection][item_id] = item

    def refs(item: dict, field: str, collection: str, path: str) -> list[str]:
        values = item.get(field)
        if not isinstance(values, list):
            fail(f"{path}.{field}", "expected array")
            return []
        valid: list[str] = []
        for value in values:
            if not isinstance(value, str) or value not in indexes[collection]:
                fail(f"{path}.{field}", f"unknown {collection} reference {value!r}")
            elif value in valid:
                fail(f"{path}.{field}", f"duplicate reference {value}")
            else:
                valid.append(value)
        return valid

    def string_list(item: dict, field: str) -> list[str]:
        values = item.get(field)
        return (
            [value for value in values if isinstance(value, str)]
            if isinstance(values, list)
            else []
        )

    for item_id, source in indexes["sources"].items():
        for field in ("title", "url", "publisher", "independence_group"):
            string(source.get(field), f"{item_id}.{field}")
        choice(
            source.get("kind"), {"official", "paper", "code", "experience", "experiment"}, item_id
        )
        choice(source.get("status"), {"inspected", "metadata_only", "inaccessible"}, item_id)
        timestamp(source.get("accessed_at"), f"{item_id}.accessed_at", nullable=True)
        if source.get("status") == "inspected" and source.get("accessed_at") is None:
            fail(item_id, "inspected source requires accessed_at")

    for item_id, evidence in indexes["evidence"].items():
        for field in ("locator", "summary", "conditions"):
            string(evidence.get(field), f"{item_id}.{field}")
        choice(
            evidence.get("basis"),
            {"documented", "author_reported", "observed", "reproduced"},
            item_id,
        )
        if not refs(evidence, "question_ids", "questions", item_id):
            fail(item_id, "evidence requires a question")
        source_id = evidence.get("source_id")
        source = indexes["sources"].get(source_id) if isinstance(source_id, str) else None
        if source is None:
            fail(item_id, "unknown source_id")
        elif source.get("status") != "inspected":
            fail(item_id, "evidence must come from an inspected source")
        if evidence.get("basis") in ("observed", "reproduced"):
            string(evidence.get("artifact"), f"{item_id}.artifact")

    for item_id, claim in indexes["claims"].items():
        string(claim.get("text"), f"{item_id}.text")
        choice(claim.get("kind"), {"fact", "inference", "recommendation"}, item_id)
        choice(claim.get("status"), {"verified", "provisional", "disputed"}, item_id)
        questions = refs(claim, "question_ids", "questions", item_id)
        support = refs(claim, "evidence_ids", "evidence", item_id)
        counter = refs(claim, "counter_evidence_ids", "evidence", item_id)
        if not questions:
            fail(item_id, "claim requires a question")
        if claim.get("status") in ("verified", "disputed") and not support:
            fail(item_id, "verified/disputed claim requires supporting evidence")
        if claim.get("status") == "disputed" and not counter:
            fail(item_id, "disputed claim requires counter evidence")
        if set(support) & set(counter):
            fail(item_id, "support and counter evidence must be distinct")
        if claim.get("status") in ("provisional", "disputed"):
            string(claim.get("limitations"), f"{item_id}.limitations")
        linked_questions = {
            q
            for eid in support + counter
            for q in string_list(indexes["evidence"][eid], "question_ids")
        }
        if support and not set(questions).issubset(linked_questions):
            fail(item_id, "evidence does not cover claim questions")

    for item_id, question in indexes["questions"].items():
        string(question.get("text"), f"{item_id}.text")
        choice(question.get("priority"), {"critical", "supporting"}, item_id)
        choice(question.get("status"), {"open", "answered", "disputed", "blocked"}, item_id)
        claims = refs(question, "claim_ids", "claims", item_id)
        for cid in claims:
            if item_id not in string_list(indexes["claims"][cid], "question_ids"):
                fail(item_id, f"{cid} does not link back to question")
        if question.get("status") == "answered" and not any(
            indexes["claims"][cid].get("status") == "verified" for cid in claims
        ):
            fail(item_id, "answered question requires verified claim")
        if question.get("status") != "answered":
            string(question.get("next_action"), f"{item_id}.next_action")

    for item_id, checkpoint in indexes["checkpoints"].items():
        timestamp(checkpoint.get("at"), f"{item_id}.at")
        choice(checkpoint.get("stage"), STAGES, item_id)
        string(checkpoint.get("summary"), f"{item_id}.summary")
        string(checkpoint.get("next_action"), f"{item_id}.next_action")
        refs(checkpoint, "open_question_ids", "questions", item_id)

    storage = project.get("storage")
    if not isinstance(storage, dict):
        fail("storage", "expected object")
    else:
        choice(
            storage.get("status"),
            {"local", "pending", "synced", "conflict", "blocked"},
            "storage.status",
        )
        timestamp(storage.get("last_confirmed_at"), "storage.last_confirmed_at", nullable=True)
        if storage.get("status") == "synced":
            for field in ("knowledge_base_id", "home_note_id"):
                string(storage.get(field), f"storage.{field}")
            if storage.get("last_confirmed_at") is None:
                fail("storage", "synced requires last_confirmed_at")

    if final or project.get("stage") == "complete":
        if not indexes["questions"] or not indexes["claims"]:
            fail("project", "final deliverable requires questions and claims")
        unresolved = {
            qid for qid, q in indexes["questions"].items() if q.get("status") != "answered"
        }
        checkpoints = list(indexes["checkpoints"].values())
        if not checkpoints:
            fail("checkpoints", "final deliverable requires a checkpoint")
        elif not unresolved.issubset(set(string_list(checkpoints[-1], "open_question_ids"))):
            fail("checkpoints", "last checkpoint must disclose every unresolved question")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--final", action="store_true")
    args = parser.parse_args()
    try:
        project = json.loads(args.project.read_text(encoding="utf-8"))
        errors = validate(project, final=args.final)
    except (OSError, ValueError) as exc:
        errors = [f"input: {exc}"]
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
