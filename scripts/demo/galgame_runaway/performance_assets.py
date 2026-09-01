# ruff: noqa: F403, F405, I001

from __future__ import annotations

from scripts.demo.galgame_runaway.performance_upgrade import *  # noqa: F403


def source_entries(
    source_root: Path,
    original_source_root: Path,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for relative_directory, category in LIBRARY_GROUPS:
        directory = source_root / relative_directory
        entries.extend(
            {
                "path": path,
                "relative": path.relative_to(source_root).as_posix(),
                "category": category,
            }
            for path in sorted(directory.iterdir())
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        )
    for pose, variant in SUZUHA_VARIANTS.values():
        for mouth in range(3):
            path, relative = suzuha_crop_entry(pose, variant, mouth)
            entries.append(
                {
                    "path": path,
                    "relative": relative,
                    "category": "character",
                }
            )
    for character_spec in CURATED_CHARACTER_POSES:
        source_directory = character_spec["sourceDirectory"]
        for pose_spec in character_spec["poses"]:
            pose = pose_spec["code"]
            for variant in range(1, len(pose_spec["labels"]) + 1):
                for mouth in range(3):
                    path, relative = curated_portrait_entry(
                        source_root, source_directory, pose, variant, mouth
                    )
                    entries.append(
                        {
                            "path": path,
                            "relative": relative,
                            "category": "character",
                        }
                    )
    entries.extend(
        {
            "path": spec["path"] if spec["path"].is_absolute() else REPO_ROOT / spec["path"],
            "relative": spec["relative"],
            "category": "cg",
        }
        for spec in CG_ASSETS
    )
    entries.extend(
        {
            "path": spec["path"],
            "relative": spec["relative"],
            "category": "scene",
        }
        for spec in CUSTOM_SCENES
    )
    entries.extend(
        {
            "path": original_source_root / "backgrounds" / "scenes" / f"{code}.PNG",
            "relative": f"sg-original/backgrounds/scenes/{code}.PNG",
            "virtualPath": f"sg/backgrounds/scenes/{code}.PNG",
            "category": "scene",
        }
        for code, _name, _distance in ORIGINAL_SG_SCENES
    )
    missing = [str(item["path"]) for item in entries if not item["path"].is_file()]
    if missing:
        raise RuntimeError("缺少计划中的源素材：" + "、".join(missing[:10]))
    unique = {item["relative"]: item for item in entries}
    return [unique[key] for key in sorted(unique)]


def logical_library_entries(
    source_root: Path,
    original_source_root: Path,
) -> list[dict[str, Any]]:
    return [
        item
        for item in source_entries(source_root, original_source_root)
        if any(item["relative"].startswith(f"{directory}/") for directory, _ in LIBRARY_GROUPS)
    ]


def load_asset_map(project_id: str, source_root: Path) -> dict[str, Any]:
    if MAP_PATH.is_file():
        current = json.loads(MAP_PATH.read_text(encoding="utf-8"))
        if current.get("projectId") == project_id:
            return current
    return {
        "version": 1,
        "projectId": project_id,
        "sourceRoot": str(source_root),
        "updatedAt": timestamp(),
        "items": {},
    }


def upload_assets(
    client: httpx.Client,
    project_id: str,
    source_root: Path,
    original_source_root: Path,
    batch_size: int,
) -> dict[str, Any]:
    entries = source_entries(source_root, original_source_root)
    library_count = len(logical_library_entries(source_root, original_source_root))
    if library_count != 701:
        raise RuntimeError(f"原作背景/CG 应为 701 项，实际发现 {library_count} 项")
    request_json(
        client,
        "POST",
        project_path(project_id, "/assets/metadata-scan"),
    )
    listed = request_json(client, "GET", project_path(project_id, "/assets"))["items"]
    assets_by_id = {asset["id"]: asset for asset in listed}
    assets_by_checksum = {
        asset["checksumSha256"]: asset for asset in listed if asset.get("checksumSha256")
    }
    mapping = load_asset_map(project_id, source_root)
    mapping_items: dict[str, Any] = mapping["items"]
    pending_by_checksum: dict[str, dict[str, Any]] = {}

    for index, entry in enumerate(entries, start=1):
        checksum = sha256(entry["path"])
        entry["sha256"] = checksum
        mapped = mapping_items.get(entry["relative"])
        mapped_asset = assets_by_id.get(mapped.get("assetId")) if mapped else None
        if mapped_asset and mapped_asset.get("checksumSha256") == checksum:
            continue
        existing = assets_by_checksum.get(checksum)
        if existing:
            mapping_items[entry["relative"]] = {
                "sha256": checksum,
                "assetId": existing["id"],
                "virtualPath": existing["virtualPath"],
                "category": entry["category"],
                "reused": True,
            }
            continue
        primary = pending_by_checksum.setdefault(checksum, {**entry, "aliases": []})
        if primary["relative"] != entry["relative"]:
            primary["aliases"].append(entry["relative"])
        if index % 50 == 0:
            print(f"已校验源素材 {index}/{len(entries)}", flush=True)

    pending = list(pending_by_checksum.values())
    uploaded_count = 0
    for category in ("scene", "cg", "character"):
        category_pending = [item for item in pending if item["category"] == category]
        for start in range(0, len(category_pending), max(1, batch_size)):
            batch = category_pending[start : start + max(1, batch_size)]
            with ExitStack() as stack:
                files = [
                    (
                        "uploads",
                        (
                            item["path"].name,
                            stack.enter_context(item["path"].open("rb")),
                            mimetypes.guess_type(item["path"].name)[0]
                            or "application/octet-stream",
                        ),
                    )
                    for item in batch
                ]
                uploaded = request_json(
                    client,
                    "POST",
                    project_path(project_id, "/assets/batch"),
                    files=files,
                    data={"category": category},
                )
            for entry, asset in zip(batch, uploaded["items"], strict=True):
                desired_path = entry.get("virtualPath", f"sg0/{entry['relative']}")
                patched = request_json(
                    client,
                    "PATCH",
                    project_path(project_id, f"/assets/{asset['id']}"),
                    payload={
                        "expectedRevision": asset["revision"],
                        "category": entry["category"],
                        "virtualPath": desired_path,
                        "packagingPolicy": "auto",
                    },
                )
                record = {
                    "sha256": entry["sha256"],
                    "assetId": patched["id"],
                    "virtualPath": patched["virtualPath"],
                    "category": entry["category"],
                    "reused": False,
                }
                mapping_items[entry["relative"]] = record
                for alias in entry["aliases"]:
                    mapping_items[alias] = {**record, "reused": True}
                assets_by_checksum[entry["sha256"]] = patched
            uploaded_count += len(batch)
            mapping["updatedAt"] = timestamp()
            write_json(MAP_PATH, mapping)
            print(
                f"已上传 {uploaded_count}/{len(pending)} 个新增文件",
                flush=True,
            )

    mapping["updatedAt"] = timestamp()
    write_json(MAP_PATH, mapping)
    print(
        json.dumps(
            {
                "logicalLibraryAssets": library_count,
                "logicalTotal": len(entries),
                "newUploads": len(pending),
                "mapping": str(MAP_PATH),
            },
            ensure_ascii=False,
        )
    )
    return mapping
