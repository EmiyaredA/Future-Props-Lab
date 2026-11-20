#!/usr/bin/env python3
"""Apply a visually reviewed card manifest through the authenticated public SDK.

The manifest and resumable receipts belong in .runtime; no database or asset-directory writes.
Defaults to a dry run. An unchanged manifest can safely be applied again.
"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path

from future_props_lab.website import website_client


def dump(value):
    return value.model_dump(mode="json")


def write(path, value):
    temporary = path.with_suffix(".pending")
    with open(temporary, "w", opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def image_hash(client, identity):
    digest = hashlib.sha256()
    with client.files.preview_file(asset_id=identity) as response:
        for chunk in response.iter_bytes():
            digest.update(chunk)
    return digest.hexdigest()


def card_body(card):
    return {
        key: value
        for key, value in card.items()
        if key
        not in {
            "id",
            "revision",
            "source_project_id",
            "media_projects",
        }
    }


def execute(client, manifest, state_dir):
    receipt_path = state_dir / "receipt.json"
    receipt = (
        json.loads(receipt_path.read_text())
        if receipt_path.exists()
        else {
            "imports": {},
            "created": [],
            "updated": [],
            "projects": [],
        }
    )
    fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    if receipt.get("manifest_sha256", fingerprint) != fingerprint:
        raise ValueError("Manifest changed; use a separate state directory")
    receipt["manifest_sha256"] = fingerprint
    write(receipt_path, receipt)
    cards = {card.id: dump(card) for card in client.visual.list_account_asset_cards()}
    titles = {}
    for card in cards.values():
        if not card["archived"]:
            if card["title"] in titles:
                raise ValueError(f"Duplicate card title requires review: {card['title']}")
            titles[card["title"]] = card["id"]
    hashes = dict(manifest["asset_hashes"])
    by_hash = {}
    for card in cards.values():
        for identity, project in card["media_projects"].items():
            if project is None and identity in hashes:
                by_hash.setdefault(hashes[identity], identity)
    by_hash.update(receipt["imports"])
    before_cards = state_dir / "before-cards.json"
    if not before_cards.exists():
        affected = {spec["title"] for spec in manifest["cards"]}
        write(before_cards, [card for card in cards.values() if card["title"] in affected])

    # Discover committed imports after a lost response before creating another copy.
    library = []
    folders = client.files.list_file_folders().items
    for folder in [None, *[item.id for item in folders]]:
        library.extend(
            client.files.list_files(
                media_kind="image", **({"folder_id": folder} if folder else {})
            ).items
        )
    for item in library:
        if item.id in hashes:
            by_hash.setdefault(hashes[item.id], item.id)

    def image(identity, kind):
        digest = hashes[identity]
        if digest in by_hash:
            return by_hash[digest]
        source = manifest["asset_sources"][identity]
        if source.get("source") == "library" or source.get("project_id") is None:
            if image_hash(client, identity) != digest:
                raise ValueError("Reviewed image changed")
            by_hash[digest] = identity
            return identity
        for item in library:
            if source.get("byte_size") and item.byte_size != source["byte_size"]:
                continue
            if item.id not in hashes:
                hashes[item.id] = image_hash(client, item.id)
            if hashes[item.id] == digest:
                by_hash[digest] = item.id
                return item.id
        receipt["pending_import"] = {"source": identity, "sha256": digest}
        write(receipt_path, receipt)
        imported = client.files.import_project_assets_to_library(
            body={
                "source_project_id": source["project_id"],
                "asset_ids": [identity],
                "folder_id": manifest["folders"][kind],
            }
        ).items
        if len(imported) != 1 or image_hash(client, imported[0].id) != digest:
            raise ValueError("Imported image did not match reviewed content")
        result = imported[0]
        library.append(result)
        hashes[result.id] = digest
        by_hash[digest] = result.id
        receipt["imports"][digest] = result.id
        receipt.pop("pending_import", None)
        write(receipt_path, receipt)
        return result.id

    # Create/update cards first. Parent changes go through the explicit regroup command below.
    for spec in manifest["cards"]:
        images = list(dict.fromkeys(image(identity, spec["kind"]) for identity in spec["images"]))
        old = cards.get(titles.get(spec["title"]))
        if old and old["kind"] != spec["kind"]:
            raise ValueError("Reviewed card kind no longer matches")
        body = (
            card_body(old)
            if old
            else {
                "kind": spec["kind"],
                "title": spec["title"],
                "design": spec["design"],
                "adopted_asset_id": images[0],
            }
        )
        body["candidate_asset_ids"] = list(
            dict.fromkeys(
                [
                    *body.get("candidate_asset_ids", []),
                    *[identity for identity in images if identity != body["adopted_asset_id"]],
                ]
            )
        )
        if old and body == card_body(old):
            continue
        receipt["pending_card"] = spec["title"]
        write(receipt_path, receipt)
        saved = (
            dump(
                client.visual.put_account_asset_card(
                    card_id=old["id"],
                    body={**body, "expected_revision": old["revision"]},
                )
            )
            if old
            else dump(client.visual.create_account_asset_card(body=body))
        )
        cards[saved["id"]] = saved
        titles[saved["title"]] = saved["id"]
        receipt["updated" if old else "created"].append(saved["id"])
        receipt.pop("pending_card", None)
        write(receipt_path, receipt)

    groups = {}
    for spec in manifest["cards"]:
        if spec.get("parent_title"):
            groups.setdefault(titles[spec["parent_title"]], []).append(titles[spec["title"]])
    for main_id, identities in groups.items():
        main = cards[main_id]
        if all(
            cards[i].get("parent_id") == main_id
            and cards[i].get("parent_asset_id") == main["adopted_asset_id"]
            for i in identities
        ):
            continue
        body = {
            "main_card_id": main_id,
            "variant_ids": identities,
            "expected_revisions": {i: cards[i]["revision"] for i in [main_id, *identities]},
        }
        for card in client.visual.regroup_account_asset_cards(body=body):
            cards[card.id] = dump(card)

    for spec in manifest["projects"]:
        document = dump(client.visual.get_canvas(project_id=spec["id"]))
        before = {
            key: value
            for key, value in document.items()
            if key
            in {
                "nodes",
                "edges",
                "categories",
                "groups",
                "project_card_ids",
            }
        }
        desired = json.loads(json.dumps(before))
        nodes = {node["id"]: node for node in desired["nodes"]}
        wanted = set(desired.get("project_card_ids") or [])
        for node_id, title in spec["bindings"].items():
            node = nodes[node_id]
            if node.get("asset_id") != spec["node_assets"][node_id]:
                raise ValueError(f"Node changed since visual review: {node_id}")
            card = cards[titles[title]]
            node.update(design_card_id=card["id"], design_card_revision=card["revision"])
            wanted.add(card["id"])
        for title in spec["card_titles"]:
            card = cards[titles[title]]
            wanted.add(card["id"])
            if card.get("parent_id"):
                wanted.add(card["parent_id"])
        for node_id, category in spec.get("reclassify", {}).items():
            node = nodes[node_id]
            if node.get("asset_id") != spec["node_assets"][node_id]:
                raise ValueError(f"Node changed since review: {node_id}")
            node["category_id"] = category
            node["group"] = None
        categories = desired.get("categories") or []
        for category in spec.get("categories", []):
            if not any(item["id"] == category["id"] for item in categories):
                categories.append(category)
        desired["categories"] = categories
        desired["project_card_ids"] = sorted(wanted)
        if desired == before:
            continue
        backup = state_dir / f"before-canvas-{spec['id']}.json"
        if not backup.exists():
            write(backup, document)
        saved = dump(
            client.visual.put_canvas(
                project_id=spec["id"],
                body={
                    **desired,
                    "expected_revision": document["revision"],
                },
            )
        )
        if before["edges"] != saved["edges"] or [n["id"] for n in before["nodes"]] != [
            n["id"] for n in saved["nodes"]
        ]:
            raise ValueError("Canvas history invariants changed")
        for previous, current in zip(before["nodes"], saved["nodes"], strict=True):
            for key in (
                "asset_id",
                "final_output_id",
                "final_version",
                "output_sequence",
                "generation_task_id",
                "generation_batch_id",
                "generation_draft",
                "text",
            ):
                old_value, new_value = previous.get(key), current.get(key)
                if key == "output_sequence":
                    old_value, new_value = old_value or 0, new_value or 0
                if old_value != new_value:
                    raise ValueError(
                        f"Canvas content changed during curation: {previous['id']}:{key}"
                    )
        receipt["projects"].append({"id": spec["id"], "revision": saved["revision"]})
        write(receipt_path, receipt)
    receipt["complete"] = True
    write(receipt_path, receipt)
    print(json.dumps({key: len(receipt[key]) for key in ["created", "updated", "projects"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    runtime = Path(".runtime").resolve()
    if not args.state_dir.resolve().is_relative_to(
        runtime
    ) or not args.manifest.resolve().is_relative_to(runtime):
        raise ValueError("Manifest and recovery receipts must reside under .runtime")
    manifest = json.loads(args.manifest.read_text())
    if not args.apply:
        print(
            json.dumps(
                {
                    "cards": len(manifest["cards"]),
                    "projects": len(manifest["projects"]),
                    "apply": False,
                }
            )
        )
        return
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.state_dir / "apply.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with website_client(profile_dir=args.profile_dir) as client:
            execute(client, manifest, args.state_dir)


if __name__ == "__main__":
    main()
