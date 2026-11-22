"""Bind explicitly curated character recordings through the account-scoped public SDK.

Audio discovery and editing happen before this command. The manifest names every
card and records each recording's source and digest; no title-based auto-matching.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

import httpx
from future_props_lab.website import website_client


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_json(path, value, *, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path, follow_symlinks=False)
        else:
            os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def audio_digest(client, asset_id):
    with client.files.preview_file(asset_id=asset_id) as download:
        checksum = hashlib.sha256()
        for chunk in download.iter_bytes():
            checksum.update(chunk)
        return checksum.hexdigest()


def validate_manifest(client, manifest, media_root):
    if client.automation.capabilities().user_id != manifest["account_id"]:
        raise ValueError("Manifest belongs to a different account")
    cards = {item.id: item for item in client.visual.list_account_asset_cards()}
    selected = set()
    for group in manifest["characters"]:
        root = cards[group["root_card_id"]]
        if root.parent_id or root.kind != "character" or root.title != group["title"]:
            raise ValueError("Character root changed; inspect the manifest again")
        ids = set(group["card_ids"])
        family = {
            item.id for item in cards.values() if item.id == root.id or item.parent_id == root.id
        }
        if not ids or ids != family or selected & ids:
            raise ValueError("Manifest must cover each complete family exactly once")
        selected |= ids
        sample = group["sample"]
        file = (media_root / sample["file"]).resolve(strict=True)
        if not file.is_relative_to(media_root.resolve()) or not sample.get("source_page"):
            raise ValueError("Recording needs a source and a file inside the explicit media root")
        if digest(file.read_bytes()) != sample["sha256"]:
            raise ValueError("Recording digest changed")
    return cards


def bind_voices(client, manifest, media_root, report_path, backup_dir):
    cards = validate_manifest(client, manifest, media_root)
    fingerprint = digest(json.dumps(manifest, sort_keys=True, ensure_ascii=False).encode())
    report_path, backup_dir = Path(report_path), Path(backup_dir)
    report = (
        json.loads(report_path.read_text())
        if report_path.exists()
        else {
            "manifest_sha256": fingerprint,
            "account_id": manifest["account_id"],
            "assets": {},
            "confirmed_cards": {},
        }
    )
    if report["manifest_sha256"] != fingerprint or report["account_id"] != manifest["account_id"]:
        raise ValueError("Receipt belongs to a different manifest/account")
    for group in manifest["characters"]:
        sample = group["sample"]
        checksum = sample["sha256"]
        asset_id = report["assets"].get(checksum)
        if not asset_id:
            label = f"{group['title']} · 日语原声参考 · {checksum[:12]}"
            matches = [
                item
                for item in client.files.list_files(query=label, media_kind="audio").items
                if item.display_name == label and item.project_id is None
            ]
            verified = [item for item in matches if audio_digest(client, item.id) == checksum]
            if verified:
                asset_id = sorted(verified, key=lambda item: item.id)[0].id
            else:
                file = media_root / sample["file"]
                with file.open("rb") as stream:
                    uploaded = client.files.upload_file(
                        body={"display_name": label},
                        files={"upload": (file.name, stream, sample["mime_type"])},
                    )
                asset_id = uploaded.id
            report["assets"][checksum] = asset_id
            private_json(report_path, report)
        if audio_digest(client, asset_id) != checksum:
            raise ValueError("Uploaded audio does not match the reviewed recording")
        for identity in group["card_ids"]:
            current = client.visual.get_account_asset_card(card_id=identity)
            if current.kind != "character" or current.parent_id != cards[identity].parent_id:
                raise ValueError("Card family changed during binding")
            if current.voice_asset_id != asset_id:
                backup = backup_dir / f"{identity}-r{current.revision}.json"
                if not backup.exists():
                    private_json(backup, current.model_dump(mode="json"), exclusive=True)
                body = current.model_dump(
                    mode="json", exclude={"id", "revision", "media_projects", "source_project_id"}
                )
                body.update(voice_asset_id=asset_id, expected_revision=current.revision)
                client.visual.put_account_asset_card(card_id=identity, body=body)
            saved = client.visual.get_account_asset_card(card_id=identity)
            if saved.voice_asset_id != asset_id:
                raise ValueError("Card voice was not confirmed; inspect before retrying")
            report["confirmed_cards"][identity] = {
                "asset_id": asset_id,
                "revision": saved.revision,
                "title": saved.title,
            }
            private_json(report_path, report)
    final = {card.id: card for card in client.visual.list_account_asset_cards()}
    for identity, confirmed in report["confirmed_cards"].items():
        if final[identity].voice_asset_id != confirmed["asset_id"]:
            raise ValueError("A voice binding changed before final verification")
    report["complete"] = True
    report["card_count"] = len(report["confirmed_cards"])
    private_json(report_path, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--media-root", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--backup-dir", required=True, type=Path)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", default="default")
    parser.add_argument("--profile-dir", type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    with website_client(
        url=args.url,
        profile=args.profile,
        profile_dir=args.profile_dir,
        transport=httpx.HTTPTransport(trust_env=False),
    ) as client:
        result = bind_voices(client, manifest, args.media_root, args.report, args.backup_dir)
    print(json.dumps({"complete": result["complete"], "card_count": result["card_count"]}))


if __name__ == "__main__":
    main()
