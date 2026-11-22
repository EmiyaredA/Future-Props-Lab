"""Audit, consolidate and restore exact duplicate materials through public APIs only."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from future_props_lab.website import website_client
from scripts.maintenance.material_dedupe_rules import (
    UnsafeMerge,
    canvas_body,
    card_body,
    remap_canvas,
    remap_card,
)


def dump(model):
    return model.model_dump(mode="json", exclude_unset=True)


def private_json(path, value, *, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def resources(client, project_ids):
    return {
        "user_id": client.automation.capabilities().user_id,
        "canvases": {
            identity: dump(client.visual.get_canvas(project_id=identity))
            for identity in project_ids
        },
        "cards": [dump(card) for card in client.visual.list_account_asset_cards()],
        "usage": dump(client.visual.get_visual_material_usage()),
    }


def step(audit, key, remove=()):
    return {
        "expected_revision": audit["revision"],
        "content_key": key,
        "remove_asset_ids": list(remove),
    }


def preflight(snapshot, group):
    members = group["members"]
    canonical = group["canonical_id"]
    frozen = set(snapshot["usage"]["frozen_asset_ids"])
    active = set(snapshot["usage"]["active_project_ids"])
    if any(item["project_id"] in active for item in members):
        raise UnsafeMerge("active_project_tasks")
    for project in {item["project_id"] for item in members if item["project_id"]}:
        placements = [item for item in members if item["project_id"] == project]
        if len({(item.get("display_name"), item.get("folder_id")) for item in placements}) > 1:
            raise UnsafeMerge("distinct_project_names_or_folders")
    moving = {
        item["id"]: canonical
        for item in members
        if item["id"] != canonical
        and item["id"] not in frozen
        and not any(
            reason in {"project-placement", "prepared-reference", "dedupe-recovery"}
            or not reason.startswith("visual:")
            for reason in item.get("protected_by", [])
        )
    }
    if not moving:
        raise UnsafeMerge("only_frozen_references")
    for canvas in snapshot["canvases"].values():
        remap_canvas(canvas, moving, {})
        for node in canvas["nodes"]:
            draft = node.get("generation_draft") or {}
            prompt = draft.get("prompt", "")
            kept = next((item for item in members if item["id"] == canonical), members[0])
            for item in members:
                if (
                    item["id"] in moving
                    and item["original_filename"] != kept["original_filename"]
                    and f"[{item['original_filename']}]" in prompt
                ):
                    raise UnsafeMerge("legacy_filename_prompt_binding")
    for card in snapshot["cards"]:
        remap_card(card, moving)
    return moving


def verify_preflight(client, before, project_ids):
    current = resources(client, project_ids)
    if current["user_id"] != before["user_id"] or fingerprint(current) != fingerprint(before):
        raise UnsafeMerge("resources_changed_before_apply")


def ensure_placements(client, mapping, canonical, group, canvases, record, journal):
    if canonical["project_id"] is not None:
        return
    for project, canvas in canvases.items():
        placed = any(
            item["project_id"] == project and item["id"] in mapping for item in group["members"]
        )
        if not placed and not any(old in json.dumps(canvas) for old in mapping):
            continue
        chosen = next(
            (
                item
                for item in group["members"]
                if item["project_id"] == project and item["id"] in mapping
            ),
            None,
        )
        existing = client.files.list_files(project_id=project, include_references=True).items
        if any(item.id == canonical["id"] for item in existing):
            continue
        change = {"project_id": project, "asset_id": canonical["id"], "state": "creating"}
        record.setdefault("placements", []).append(change)
        private_json(journal, record)
        link = dump(
            client.visual.create_asset_reference(
                project_id=project,
                body={
                    "asset_id": canonical["id"],
                    "folder_id": chosen.get("folder_id") if chosen else None,
                },
            )
        )
        change.update(reference_id=link.get("reference_id"), after=link, state="created")
        private_json(journal, record)
        if chosen and link.get("reference_id"):
            updated = dump(
                client.visual.patch_asset_reference(
                    project_id=project,
                    reference_id=link["reference_id"],
                    body={
                        "expected_revision": link["revision"],
                        "display_name": chosen["display_name"],
                    },
                )
            )
            change["after"] = updated
            private_json(journal, record)


def apply_group(client, audit, key, recovery, report):
    group = next(item for item in audit["groups"] if item["content_key"] == key)
    if group["state"] in {"cleaned", "restored"}:
        return audit
    before = resources(client, audit["project_ids"])
    provisional = preflight(before, group)
    verify_preflight(client, before, audit["project_ids"])
    folder = recovery / key
    record = {
        "operation_id": audit["id"],
        "group": group,
        "before": {"user_id": before["user_id"]},
        "changes": [],
        "state": "inspected",
    }
    journal = folder / "recovery.json"
    if journal.exists():
        previous = json.loads(journal.read_text())
        if previous["state"] not in {"inspected", "completed", "rolled_back"}:
            raise UnsafeMerge("pending_recovery_requires_restore")
        if previous["state"] == "completed":
            return dump(client.files.get_file_content_audit(operation_id=audit["id"]))
    private_json(journal, record)
    audit = dump(
        client.files.prepare_file_duplicate_group(operation_id=audit["id"], body=step(audit, key))
    )
    group = next(item for item in audit["groups"] if item["content_key"] == key)
    canonical_id = group["canonical_id"]
    mapping = {old: canonical_id for old in provisional}
    # A promoted shared original may replace the former canonical as well.
    if canonical_id not in {item["id"] for item in group["members"]}:
        old_canonical = record["group"]["canonical_id"]
        if old_canonical not in before["usage"]["frozen_asset_ids"]:
            mapping[old_canonical] = canonical_id
    for canvas in before["canvases"].values():
        remap_canvas(canvas, mapping, {})
    record.update(state="prepared", mapping=mapping)
    private_json(journal, record)
    canonical = next(
        (item for item in group["members"] if item["id"] == canonical_id),
        {"id": canonical_id, "project_id": None},
    )
    ensure_placements(client, mapping, canonical, group, before["canvases"], record, journal)
    private_json(journal, record)
    card_revisions = {}
    for card in before["cards"]:
        after = remap_card(card, mapping)
        if after == card:
            continue
        record["changes"].append(
            {"kind": "card", "id": card["id"], "before": card, "intended": after}
        )
        private_json(journal, record)
        updated = dump(
            client.visual.put_account_asset_card(
                card_id=card["id"], body=card_body(after, card["revision"])
            )
        )
        record["changes"][-1]["after"] = updated
        card_revisions[card["id"]] = updated["revision"]
        private_json(journal, record)
    for project, canvas in before["canvases"].items():
        after = remap_canvas(canvas, mapping, card_revisions)
        if after == canvas:
            continue
        record["changes"].append(
            {"kind": "canvas", "id": project, "before": canvas, "intended": after}
        )
        private_json(journal, record)
        updated = dump(
            client.visual.put_canvas(
                project_id=project, body=canvas_body(after, canvas["revision"])
            )
        )
        if updated["nodes"] != after["nodes"]:
            raise UnsafeMerge("canvas_response_mismatch")
        record["changes"][-1]["after"] = updated
        private_json(journal, record)
    # Re-read committed resources; a lost response or concurrent edit never authorizes deletion.
    current = resources(client, audit["project_ids"])
    expected_cards = {card["id"]: card for card in before["cards"]}
    expected_canvases = dict(before["canvases"])
    for change in record["changes"]:
        if "after" not in change:
            raise UnsafeMerge("unknown_write_result")
        (expected_cards if change["kind"] == "card" else expected_canvases)[change["id"]] = change[
            "after"
        ]
    if {card["id"]: card for card in current["cards"]} != expected_cards or current[
        "canvases"
    ] != expected_canvases:
        raise UnsafeMerge("resources_changed_after_apply")
    if set(mapping) & set(current["usage"]["frozen_asset_ids"]) or {
        item["project_id"] for item in group["members"]
    } & set(current["usage"]["active_project_ids"]):
        raise UnsafeMerge("new_frozen_or_active_usage")
    record["state"] = "references_verified"
    private_json(journal, record)
    audit = dump(
        client.files.clean_file_duplicate_group(
            operation_id=audit["id"], body=step(audit, key, mapping)
        )
    )
    record["state"] = "completed"
    record["result"] = next(item for item in audit["groups"] if item["content_key"] == key)
    private_json(journal, record)
    report.append(
        {
            "content_key": key,
            "state": "completed",
            "removed_ids": record["result"]["removed_ids"],
            "skipped": record["result"]["skipped"],
        }
    )
    return audit


def restore_group(client, operation, folder):
    path = folder / "recovery.json"
    record = json.loads(path.read_text())
    if client.automation.capabilities().user_id != record["before"]["user_id"]:
        raise UnsafeMerge("wrong_recovery_account")
    audit = dump(client.files.get_file_content_audit(operation_id=operation))
    key = record["group"]["content_key"]
    group = next(item for item in audit["groups"] if item["content_key"] == key)
    if group["state"] == "cleaned":
        client.files.restore_file_duplicate_group(operation_id=operation, body=step(audit, key))
    card_revisions = {}
    # Restored card data creates a new revision; restore drafts against that revision.
    changes = sorted(record["changes"], key=lambda item: item["kind"] != "card")
    for change in changes:
        if change.get("restored"):
            if change["kind"] == "card":
                card_revisions[change["id"]] = change["restored"]["revision"]
            continue
        current = (
            dump(client.visual.get_account_asset_card(card_id=change["id"]))
            if change["kind"] == "card"
            else dump(client.visual.get_canvas(project_id=change["id"]))
        )
        original = (
            remap_canvas(change["before"], {}, card_revisions)
            if change["kind"] == "canvas"
            else change["before"]
        )
        body = card_body if change["kind"] == "card" else canvas_body
        if body(current, 0) == body(original, 0):
            # A previous restore may have committed before its response was lost.
            change["restored"] = current
            if change["kind"] == "card":
                card_revisions[change["id"]] = current["revision"]
            private_json(path, record)
            continue
        expected = change.get("after")
        if expected is None:

            def content(item):
                return {k: v for k, v in item.items() if k not in {"revision", "updated_at"}}

            if content(current) == content(change["before"]):
                continue
            if content(current) != content(change["intended"]):
                raise UnsafeMerge("recovery_conflicts_with_new_changes")
        elif current != expected:
            raise UnsafeMerge("recovery_conflicts_with_new_changes")
        if change["kind"] == "card":
            restored = dump(
                client.visual.put_account_asset_card(
                    card_id=change["id"], body=card_body(change["before"], current["revision"])
                )
            )
            card_revisions[change["id"]] = restored["revision"]
        else:
            original = remap_canvas(change["before"], {}, card_revisions)
            restored = dump(
                client.visual.put_canvas(
                    project_id=change["id"], body=canvas_body(original, current["revision"])
                )
            )
        change["restored"] = restored
        private_json(path, record)
    for placement in record.get("placements", []):
        # An unknown create result is kept; it never authorizes removing somebody else's placement.
        if placement.get("state") != "created" or placement.get("removed"):
            continue
        links = client.files.list_files(
            project_id=placement["project_id"], include_references=True
        ).items
        current = next(
            (dump(item) for item in links if item.reference_id == placement.get("reference_id")),
            None,
        )
        if current is None:
            placement["removed"] = True
            private_json(path, record)
            continue
        if current != placement.get("after"):
            raise UnsafeMerge("placement_changed_during_recovery")
        client.visual.delete_asset_reference(
            project_id=placement["project_id"],
            reference_id=current["reference_id"],
            expected_revision=current["revision"],
        )
        placement["removed"] = True
        private_json(path, record)
    record["state"] = "rolled_back"
    private_json(path, record)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "apply", "status", "restore"))
    parser.add_argument("--url")
    parser.add_argument("--profile", default="default")
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--operation")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--recovery-dir", type=Path)
    parser.add_argument("--group")
    args = parser.parse_args()
    if args.command in {"apply", "restore"} and (
        not args.recovery_dir
        or ".runtime" not in args.recovery_dir.resolve().parts
        or ".local" in args.recovery_dir.resolve().parts
    ):
        parser.error("恢复记录必须放在持久 .runtime 目录，不能依赖 .local")
    with website_client(url=args.url, profile=args.profile, profile_dir=args.profile_dir) as client:
        if args.command == "inspect":
            projects = client.visual.list_projects().items
            audit = dump(
                client.files.create_file_content_audit(
                    body={
                        "request_id": "visual-" + uuid4().hex,
                        "project_ids": [p.id for p in projects],
                    }
                )
            )
            result = {"audit": audit, "snapshot": resources(client, audit["project_ids"])}
        else:
            if not args.operation:
                parser.error("需要 --operation")
            audit = dump(client.files.get_file_content_audit(operation_id=args.operation))
            if args.command == "status":
                result = {"audit": audit}
            elif args.command == "restore":
                if not args.group:
                    parser.error("恢复需要 --group")
                restore_group(client, args.operation, args.recovery_dir / args.group)
                result = {
                    "audit": dump(client.files.get_file_content_audit(operation_id=args.operation))
                }
            else:
                report = []
                initial = resources(client, audit["project_ids"])
                for group in audit["groups"]:
                    if group["state"] in {"cleaned", "restored"}:
                        continue
                    if args.group and group["content_key"] != args.group:
                        continue
                    try:
                        # Other groups cannot change frozen history or distinct placements.
                        preflight(initial, group)
                        audit = apply_group(
                            client, audit, group["content_key"], args.recovery_dir, report
                        )
                    except Exception as exc:
                        # Roll back uncertain writes before attempting another group.
                        report.append(
                            {
                                "content_key": group["content_key"],
                                "state": "skipped",
                                "reason": str(exc),
                            }
                        )
                        journal = args.recovery_dir / group["content_key"] / "recovery.json"
                        if journal.exists() and json.loads(journal.read_text())["state"] not in {
                            "inspected",
                            "completed",
                            "rolled_back",
                        }:
                            restore_group(client, args.operation, journal.parent)
                        audit = dump(
                            client.files.get_file_content_audit(operation_id=args.operation)
                        )
                    private_json(args.output, {"audit": audit, "report": report})
                result = {"audit": audit, "report": report}
        private_json(args.output, result)
        print(
            json.dumps(
                {
                    "operation_id": audit["id"],
                    "groups": len(audit["groups"]),
                    "removed": sum(len(g["removed_ids"]) for g in audit["groups"]),
                    "reclaimed_bytes": sum(g["reclaimed_bytes"] for g in audit["groups"]),
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
