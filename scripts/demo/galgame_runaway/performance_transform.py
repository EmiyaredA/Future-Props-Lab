# ruff: noqa: F403, F405, I001

from __future__ import annotations

from scripts.demo.galgame_runaway.performance_upgrade import *  # noqa: F403


def find_character(document: dict[str, Any], names: tuple[str, ...]) -> dict[str, Any]:
    candidates = [
        character
        for character in document.get("characters", [])
        if any(name.casefold() in character.get("name", "").casefold() for name in names)
    ]
    if not candidates:
        raise RuntimeError(f"没有找到角色：{names}")
    return candidates[0]


def first_person_okabe(document: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        character
        for character in document.get("characters", [])
        if any(name in character.get("name", "") for name in ("冈部", "岡部", "Okabe"))
    ]
    if not candidates:
        raise RuntimeError("没有找到冈部角色")
    return min(candidates, key=lambda character: len(character.get("expressions", [])))


def semantic_suzuha_expression(label: str, index: int) -> str:
    if any(word in label for word in ("爽", "笑", "开心")):
        return "cheerful"
    if any(word in label for word in ("担忧", "不安", "困惑")):
        return "worried"
    if any(word in label for word in ("严", "怒", "生气")):
        return "strict"
    if any(word in label for word in ("释然", "安心", "闭眼")):
        return "relieved"
    if any(word in label for word in ("认真", "严肃")):
        return "serious"
    return ("calm", "cheerful", "serious", "worried", "strict", "relieved")[min(index, 5)]


def ensure_story_image_asset(
    document: dict[str, Any], story_asset_id: str, role: str, file_id: str
) -> None:
    assets = document.setdefault("assets", [])
    replacement = {
        "id": story_asset_id,
        "type": "image",
        "role": role,
        "fileId": file_id,
        "status": "ready",
    }
    for index, asset in enumerate(assets):
        if asset["id"] == story_asset_id:
            assets[index] = replacement
            return
    assets.append(replacement)


def upgrade_suzuha(document: dict[str, Any], mapping: dict[str, Any]) -> str:
    suzuha = find_character(document, ("铃羽", "鈴羽", "玲羽", "Suzuha"))
    expressions = suzuha.get("expressions", [])
    if len(expressions) < 6:
        raise RuntimeError("铃羽至少需要六个既有语义表情")
    for index, expression in enumerate(expressions):
        semantic = semantic_suzuha_expression(expression.get("label", ""), index)
        pose, variant = SUZUHA_VARIANTS[semantic]
        frame_assets: list[str] = []
        for mouth in range(3):
            _source, relative = suzuha_crop_entry(pose, variant, mouth)
            record = mapping["items"].get(relative)
            if not record:
                raise RuntimeError(f"铃羽素材尚未上传：{relative}")
            normalized_pose = pose.lower().replace("_", "-")
            story_asset_id = f"sg0-suz-half-v1-{normalized_pose}-{variant}-{mouth}"
            ensure_story_image_asset(
                document, story_asset_id, "characterPortrait", record["assetId"]
            )
            frame_assets.append(story_asset_id)
        old_frames = (expression.get("sequence") or {}).get("frames", [])
        frame_ids = [
            old_frames[mouth].get("id", f"{expression['id']}-mouth-{mouth}")
            if mouth < len(old_frames)
            else f"{expression['id']}-mouth-{mouth}"
            for mouth in range(3)
        ]
        expression["assetId"] = frame_assets[0]
        expression["renderMode"] = "frameSequence"
        expression["sequence"] = {
            "playbackMode": "lipSync",
            "fps": LIP_SYNC_FPS,
            "loop": True,
            "frames": [
                {"id": frame_id, "assetId": asset_id}
                for frame_id, asset_id in zip(frame_ids, frame_assets, strict=True)
            ],
        }
    return suzuha["id"]


def set_all_lip_sync_fps(document: dict[str, Any]) -> None:
    for character in document.get("characters", []):
        for expression in character.get("expressions", []):
            sequence = expression.get("sequence")
            if sequence and sequence.get("playbackMode") == "lipSync":
                sequence["fps"] = LIP_SYNC_FPS


def build_curated_expression(
    document: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    source_directory: str,
    pose: str,
    variant: int,
    label: str,
    *,
    expression_id: str | None = None,
) -> dict[str, Any]:
    expression_id = expression_id or curated_expression_id(pose, variant)
    frame_asset_ids: list[str] = []
    for mouth in range(3):
        _path, relative = curated_portrait_entry(
            source_root, source_directory, pose, variant, mouth
        )
        record = mapping["items"].get(relative)
        if not record:
            raise RuntimeError(f"精选角色立绘尚未上传：{relative}")
        story_asset_id = f"sg0-{pose.lower().replace('_', '-')}-e{variant:03d}-f{mouth:03d}"
        ensure_story_image_asset(document, story_asset_id, "characterPortrait", record["assetId"])
        frame_asset_ids.append(story_asset_id)
    return {
        "id": expression_id,
        "label": label,
        "assetId": frame_asset_ids[0],
        "renderMode": "frameSequence",
        "sequence": {
            "playbackMode": "lipSync",
            "fps": LIP_SYNC_FPS,
            "loop": True,
            "frames": [
                {
                    "id": f"{expression_id}-mouth-{mouth}",
                    "assetId": asset_id,
                }
                for mouth, asset_id in enumerate(frame_asset_ids)
            ],
        },
    }


def install_curated_character_expressions(
    document: dict[str, Any], mapping: dict[str, Any], source_root: Path
) -> None:
    for character_spec in CURATED_CHARACTER_POSES:
        character = find_character(document, character_spec["characterNames"])
        expressions = character.setdefault("expressions", [])
        replace_primary = bool(character_spec.get("replacePrimary"))
        primary_pose = character_spec["poses"][0]["code"]
        for pose_spec in character_spec["poses"]:
            pose = pose_spec["code"]
            for variant, label in enumerate(pose_spec["labels"], start=1):
                expression_id = (
                    f"e{variant:03d}-f000"
                    if replace_primary and pose == primary_pose
                    else curated_expression_id(pose, variant)
                )
                expression = build_curated_expression(
                    document,
                    mapping,
                    source_root,
                    character_spec["sourceDirectory"],
                    pose,
                    variant,
                    label,
                    expression_id=expression_id,
                )
                expressions[:] = [
                    current for current in expressions if current["id"] != expression_id
                ]
                expressions.append(expression)


def performance_expression_id(character_id: str, expression_id: str | None) -> str | None:
    if expression_id is None:
        return None
    return CURATED_EXPRESSION_OVERRIDES.get(character_id, {}).get(expression_id, expression_id)


def performance_expression_for_turn(
    character_id: str, expression_id: str | None, speaking_turn: int
) -> str | None:
    if expression_id is None:
        return None
    candidates = PERFORMANCE_POSE_CANDIDATES.get(character_id, {}).get(expression_id)
    if not candidates:
        return performance_expression_id(character_id, expression_id)
    candidate_index = (speaking_turn // POSE_HOLD_SPEAKING_TURNS) % len(candidates)
    return candidates[candidate_index]


def enlarge_dialogue_text(document: dict[str, Any]) -> None:
    dialogue_box = document.setdefault("presentation", {}).setdefault("dialogueBox", {})
    dialogue_box["backgroundColor"] = "#05070B"
    dialogue_box["backgroundOpacity"] = DIALOGUE_BOX_OPACITY
    background = dialogue_box.setdefault("background", {})
    background["gradientTopOpacity"] = 1
    background["gradientBottomOpacity"] = 1
    body = dialogue_box.setdefault("body", {})
    body["fontSizePx"] = 34
    body["lineHeight"] = 1.5
    body["maxWidthPercent"] = 100


def install_curated_scenes(document: dict[str, Any], mapping: dict[str, Any]) -> None:
    scenes = document.setdefault("scenes", [])
    specs = [
        {
            "code": code,
            "name": name,
            "description": f"《命运石之门 0》原作场景 {code}",
            "relative": f"backgrounds/scenes/{code}.png",
            "distance": distance,
        }
        for code, name, distance in CURATED_SCENES
    ]
    specs.extend(
        {
            "code": f"SG_{code}",
            "name": name,
            "description": f"《命运石之门》原作场景 {code}",
            "relative": f"sg-original/backgrounds/scenes/{code}.PNG",
            "distance": distance,
        }
        for code, name, distance in ORIGINAL_SG_SCENES
    )
    specs.extend(CUSTOM_SCENES)
    for spec in specs:
        code = spec["code"]
        name = spec["name"]
        relative = spec["relative"]
        record = mapping["items"].get(relative)
        if not record:
            raise RuntimeError(f"场景素材尚未上传：{relative}")
        story_asset_id = scene_asset_id_for_code(code)
        scene_id = scene_id_for_code(code)
        ensure_story_image_asset(document, story_asset_id, "sceneLayer", record["assetId"])
        scene = {
            "id": scene_id,
            "name": name,
            "description": spec["description"],
            "layers": [
                {
                    "id": f"{scene_id}-layer",
                    "name": name,
                    "assetId": story_asset_id,
                    "distance": spec["distance"],
                    "offsetX": 0,
                    "offsetY": 0,
                }
            ],
        }
        for index, current in enumerate(scenes):
            if current["id"] == scene_id:
                scenes[index] = scene
                break
        else:
            scenes.append(scene)


def install_cgs(document: dict[str, Any], mapping: dict[str, Any]) -> None:
    cgs = document.setdefault("cgs", [])
    cg_by_id = {cg["id"]: index for index, cg in enumerate(cgs)}
    asset_by_key = {spec["key"]: spec for spec in CG_ASSETS}
    for spec in CG_ASSETS:
        record = mapping.get("items", {}).get(spec["relative"])
        if not record:
            raise RuntimeError(f"CG 素材尚未上传：{spec['relative']}")
        ensure_story_image_asset(document, spec["storyAssetId"], "storyCg", record["assetId"])
        cg = {
            "id": spec["cgId"],
            "name": spec["name"],
            "description": spec["description"],
            "variants": [
                {
                    "id": spec["variantId"],
                    "label": "默认",
                    "assetId": spec["storyAssetId"],
                }
            ],
            "defaultVariantId": spec["variantId"],
        }
        if spec["cgId"] in cg_by_id:
            cgs[cg_by_id[spec["cgId"]]] = cg
        else:
            cg_by_id[spec["cgId"]] = len(cgs)
            cgs.append(cg)

    fragment = target_fragment(document)
    retained = [
        block
        for block in fragment.get("blocks", [])
        if not (
            block.get("type") in {"showCg", "hideCg"}
            and block.get("id", "").startswith("runaway-cg-")
        )
        and not block.get("id", "").startswith("runaway-phone-camera-")
    ]
    cg_events: list[dict[str, Any]] = []
    for event in CG_EVENTS:
        spec = asset_by_key[event["assetKey"]]
        show_transition = {"durationMs": event["transitionMs"], "fade": True}
        cg_events.append(
            {
                "id": f"runaway-cg-show-{event['key']}",
                "type": "showCg",
                "atMs": event["startMs"],
                "cgId": spec["cgId"],
                "variantId": spec["variantId"],
                "displayMode": event["displayMode"],
                "fit": event["fit"],
                "overlay": event["overlay"],
                "transition": show_transition,
            }
        )
        if event["endMs"] is not None:
            cg_events.append(
                {
                    "id": f"runaway-cg-hide-{event['key']}",
                    "type": "hideCg",
                    "atMs": event["endMs"],
                    "transition": {
                        "durationMs": event["hideTransitionMs"],
                        "fade": True,
                    },
                }
            )
    cg_events.extend(
        (
            {
                "id": "runaway-phone-camera-offscreen",
                "type": "camera",
                "atMs": 68_050,
                "target": "cg",
                "effect": "move",
                "x": 35,
                "y": 0,
                "scale": 1,
                "rotation": 0,
                "intensity": 1,
                "durationMs": 0,
                "easing": "linear",
                "waitForCompletion": False,
            },
            {
                "id": "runaway-phone-camera-slide-in",
                "type": "camera",
                "atMs": 68_051,
                "target": "cg",
                "effect": "move",
                "x": 0,
                "y": 0,
                "scale": 1,
                "rotation": 0,
                "intensity": 1,
                "durationMs": 220,
                "easing": "easeOut",
                "waitForCompletion": False,
            },
        )
    )
    fragment["blocks"] = [*retained, *cg_events]


def install_opening_declaration(document: dict[str, Any]) -> None:
    fragment = target_fragment(document)
    retained = [
        block for block in fragment.get("blocks", []) if block.get("id") != OPENING_DECLARATION_ID
    ]
    retained.append(
        {
            "id": OPENING_DECLARATION_ID,
            "type": "floatingText",
            "atMs": 500,
            "text": OPENING_DECLARATION_TEXT,
            "x": 50,
            "y": 50,
            "color": "#F4E7C5",
            "durationMs": 10_000,
        }
    )
    fragment["blocks"] = retained


def install_ending_thanks(document: dict[str, Any]) -> None:
    fragment = target_fragment(document)
    retained = [
        block for block in fragment.get("blocks", []) if block.get("id") != ENDING_THANKS_ID
    ]
    retained.append(
        {
            "id": ENDING_THANKS_ID,
            "type": "floatingText",
            "atMs": 1_774_194,
            "text": ENDING_THANKS_TEXT,
            "x": 50,
            "y": 50,
            "color": "#F4E7C5",
            "durationMs": 6_150,
        }
    )
    fragment["blocks"] = retained


def install_transition_cards(document: dict[str, Any]) -> None:
    fragment = target_fragment(document)
    managed_ids = {block["id"] for block in TRANSITION_CARD_BLOCKS}
    retained = [block for block in fragment.get("blocks", []) if block.get("id") not in managed_ids]
    fragment["blocks"] = [*retained, *deepcopy(TRANSITION_CARD_BLOCKS)]


def dialogue_signature(fragment: dict[str, Any]) -> list[tuple[Any, ...]]:
    return [
        (
            block["id"],
            block.get("characterId"),
            tuple(block.get("speakerIds") or []),
            block.get("text"),
            block.get("startMs"),
            block.get("endMs"),
        )
        for block in fragment.get("blocks", [])
        if block.get("type") == "dialogue"
    ]


def dialogue_timeline_signature(fragment: dict[str, Any]) -> list[tuple[Any, ...]]:
    return [
        (
            block["id"],
            block.get("startMs"),
            block.get("endMs"),
            block.get("voiceAssetId"),
            block.get("voiceVolume"),
        )
        for block in fragment.get("blocks", [])
        if block.get("type") == "dialogue"
    ]


def annotation_text(segment: dict[str, Any]) -> str:
    return next(
        (
            localized["text"]
            for localized in segment.get("localized_texts", [])
            if localized.get("language") == "zh"
        ),
        segment["text"],
    )


def annotation_character_map(
    document: dict[str, Any], annotation: dict[str, Any]
) -> dict[str, str]:
    first_person_id = first_person_okabe(document)["id"]
    fixed = {
        "冈部伦太郎": first_person_id,
        "牧濑红莉栖": find_character(document, ("牧濑红莉栖",))["id"],
        "椎名真由理": find_character(document, ("椎名真由理",))["id"],
        "桥田至": find_character(document, ("桥田至",))["id"],
        "菲莉丝·喵喵": find_character(document, ("菲莉丝",))["id"],
        "阿万音铃羽": find_character(document, ("阿万音铃羽",))["id"],
        "幼年篝": find_character(document, ("幼年篝", "冈部篝"))["id"],
        "漆原琉华": find_character(document, ("漆原琉华",))["id"],
        "比屋定真帆": find_character(document, ("比屋定真帆",))["id"],
        "桐生萌郁": find_character(document, ("桐生萌郁",))["id"],
        "天王寺裕吾": find_character(document, ("天王寺裕吾",))["id"],
        "众人": find_character(document, ("众人",))["id"],
    }
    mapping = {speaker["id"]: fixed[speaker["name"]] for speaker in annotation.get("speakers", [])}
    if len(mapping) != 12:
        raise RuntimeError(f"标注说话人应为 12 名，实际为 {len(mapping)} 名")
    return mapping


def apply_annotation(document: dict[str, Any], annotation_path: Path) -> dict[str, Any]:
    if not annotation_path.is_file():
        raise RuntimeError(f"新版对白标注不存在：{annotation_path}")
    annotation_sha256 = sha256(annotation_path)
    if annotation_sha256 != EXPECTED_ANNOTATION_SHA256:
        raise RuntimeError(f"新版对白标注校验和不匹配：{annotation_sha256}")
    annotation = json.loads(annotation_path.read_text(encoding="utf-8"))
    segments = annotation.get("segments", [])
    if len(segments) != 514:
        raise RuntimeError(f"新版对白标注应为 514 条，实际为 {len(segments)} 条")
    fragment = target_fragment(document)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    by_interval = {(block["startMs"], block["endMs"]): block for block in dialogues}
    if len(by_interval) != len(dialogues):
        raise RuntimeError("现有对白时间区间并非唯一，无法精确对齐新版标注")
    speaker_map = annotation_character_map(document, annotation)
    changed_text_count = 0
    changed_speaker_count = 0
    multi_speaker_count = 0
    raw_multi_speaker_count = 0
    crowd_normalized_count = 0
    ensemble_character_id = find_character(document, ("众人",))["id"]
    expected: list[tuple[Any, ...]] = []
    for segment in segments:
        interval = (segment["start_ms"], segment["end_ms"])
        dialogue = by_interval.get(interval)
        if dialogue is None:
            raise RuntimeError(f"新版对白无法按时间对齐：{interval}")
        text = annotation_text(segment)
        character_id = speaker_map[segment["speaker_id"]]
        raw_speaker_ids = [speaker_map[speaker_id] for speaker_id in segment["speaker_ids"]]
        if len(raw_speaker_ids) > 1:
            raw_multi_speaker_count += 1
        if len(raw_speaker_ids) > 3:
            character_id = ensemble_character_id
            speaker_ids = [ensemble_character_id]
            crowd_normalized_count += 1
        else:
            speaker_ids = raw_speaker_ids
        if dialogue.get("text") != text:
            changed_text_count += 1
        if dialogue.get("characterId") != character_id:
            changed_speaker_count += 1
        if len(speaker_ids) > 1:
            multi_speaker_count += 1
        dialogue["text"] = text
        dialogue["characterId"] = character_id
        dialogue["speakerIds"] = speaker_ids
        expected.append(
            (
                dialogue["id"],
                character_id,
                tuple(speaker_ids),
                text,
                segment["start_ms"],
                segment["end_ms"],
            )
        )
    if len(dialogues) != len(expected):
        raise RuntimeError("新版对白没有完整覆盖现有 514 个对白 Block")
    return {
        "path": str(annotation_path),
        "sha256": annotation_sha256,
        "changedTextCount": changed_text_count,
        "changedSpeakerCount": changed_speaker_count,
        "multiSpeakerCount": multi_speaker_count,
        "rawMultiSpeakerCount": raw_multi_speaker_count,
        "expectedMultiSpeakerCount": EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES,
        "crowdNormalizedCount": crowd_normalized_count,
        "storyMultiSpeakerCount": sum(len(item[2]) > 1 for item in expected),
        "expectedDialogueSignature": expected,
    }


def ensure_literal_display_name(
    character: dict[str, Any], display_name_id: str, value: str
) -> None:
    display_names = character.setdefault("displayNames", [])
    replacement = {
        "id": display_name_id,
        "label": value,
        "source": "literal",
        "value": value,
    }
    for index, current in enumerate(display_names):
        if current.get("id") == display_name_id:
            display_names[index] = replacement
            return
    display_names.append(replacement)


def configure_dialogue_display_names(document: dict[str, Any]) -> None:
    fragment = target_fragment(document)
    dialogues = {
        block["id"]: block
        for block in fragment.get("blocks", [])
        if block.get("type") == "dialogue"
    }
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    kagari = find_character(document, ("幼年篝", "冈部篝"))
    kagari["name"] = "冈部篝"
    unknown_name_id = "runaway-kagari-unknown"
    ensure_literal_display_name(kagari, unknown_name_id, "红发小女孩")

    for line in range(1, 515):
        dialogue = dialogues[f"runaway-annotated-line-{line:04d}"]
        if dialogue.get("characterId") == kagari["id"] and line <= 116:
            dialogue["displayNameId"] = unknown_name_id
        elif dialogue.get("characterId") == kagari["id"]:
            dialogue.pop("displayNameId", None)

    ensemble = find_character(document, ("众人",))
    for dialogue in dialogues.values():
        if dialogue.get("displayNameId") == "runaway-ensemble-name":
            dialogue.pop("displayNameId", None)
        if dialogue.get("characterId") == ensemble["id"]:
            dialogue["speakerIds"] = [ensemble["id"]]

    for line, value in (
        (377, "冈部伦太郎、桥田至"),
        (463, "阿万音铃羽、比屋定真帆"),
    ):
        dialogue = dialogues[f"runaway-annotated-line-{line:04d}"]
        display_name_id = f"runaway-pair-name-{line}"
        character = character_by_id[dialogue["characterId"]]
        ensure_literal_display_name(character, display_name_id, value)
        dialogue["displayNameId"] = display_name_id


def install_special_character_expressions(document: dict[str, Any]) -> None:
    mayuri = find_character(document, ("椎名真由理",))
    expressions = mayuri.setdefault("expressions", [])
    source = next(
        (expression for expression in expressions if expression["id"] == "may-alc-e003-f000"),
        next(expression for expression in expressions if expression["id"] == "e002-f000"),
    )
    shy = deepcopy(source)
    shy["id"] = "e010-f000"
    shy["label"] = "害羞"
    sequence = shy.get("sequence") or {}
    for frame, mouth in zip(
        sequence.get("frames", []),
        ("closed", "half", "open"),
        strict=False,
    ):
        frame["id"] = f"e010-mouth-{mouth}"
    expressions[:] = [expression for expression in expressions if expression["id"] != shy["id"]]
    expressions.append(shy)


def normalize_expression_labels(document: dict[str, Any]) -> None:
    characters = {character["id"]: character for character in document.get("characters", [])}
    for character_id, labels in EXPRESSION_LABEL_OVERRIDES.items():
        character = characters.get(character_id)
        if not character:
            continue
        expressions = {
            expression["id"]: expression for expression in character.get("expressions", [])
        }
        for expression_id, label in labels.items():
            if expression_id in expressions:
                expressions[expression_id]["label"] = label


def rename_kurisu_expression_labels(document: dict[str, Any]) -> list[dict[str, str]]:
    return rename_audited_expression_labels(document, {"kurisu-makise"})


def rename_audited_expression_labels(
    document: dict[str, Any], character_ids: set[str] | None = None
) -> list[dict[str, str]]:
    characters = {character["id"]: character for character in document.get("characters", [])}
    selected_ids = character_ids or set(AUDITED_EXPRESSION_LABELS)
    unmapped = sorted(
        character["id"]
        for character in document.get("characters", [])
        if character.get("expressions")
        and character["id"] not in AUDITED_EXPRESSION_LABELS
        and character_ids is None
    )
    if unmapped:
        raise RuntimeError(f"存在尚未逐图核对的角色表情：{unmapped}")
    changes: list[dict[str, str]] = []
    for character_id in sorted(selected_ids):
        character = characters.get(character_id)
        if not character:
            raise RuntimeError(f"缺少待核对的角色：{character_id}")
        expressions = {
            expression["id"]: expression for expression in character.get("expressions", [])
        }
        expected = AUDITED_EXPRESSION_LABELS[character_id]
        missing = sorted(expected.keys() - expressions.keys())
        unexpected = sorted(expressions.keys() - expected.keys())
        if missing or unexpected:
            raise RuntimeError(
                f"角色 {character_id} 的表情集合与逐图清单不一致："
                f"缺少 {missing}，未核对 {unexpected}"
            )
        for expression_id, label in expected.items():
            expression = expressions[expression_id]
            previous = expression.get("label", "")
            if previous == label:
                continue
            changes.append(
                {
                    "characterId": character_id,
                    "characterName": character["name"],
                    "id": expression_id,
                    "before": previous,
                    "after": label,
                }
            )
            expression["label"] = label
    return changes


def target_fragment(document: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        fragment
        for chapter in document.get("chapters", [])
        for fragment in chapter.get("fragments", [])
        if fragment.get("timeline", {}).get("durationMs") == 1_780_344
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"应唯一找到 29:40 时间轴，实际为 {len(candidates)} 个")
    return candidates[0]


def portrait_height_percent(
    document: dict[str, Any], character_id: str, expression_id: str | None
) -> float:
    character = next(item for item in document.get("characters", []) if item["id"] == character_id)
    expression = next(
        (item for item in character.get("expressions", []) if item["id"] == expression_id),
        None,
    )
    settings = document.get("settings", {})
    override = settings.get("characterStageOverrides", {}).get(character_id, {})
    return float(
        (expression or {}).get("heightPercent")
        or override.get("defaultHeightPercent")
        or character.get("portraitHeightPercent")
        or settings.get("characterStage", {}).get("defaultHeightPercent")
        or 100
    )


def cast_member(
    document: dict[str, Any],
    character_id: str,
    expression_id: str | None,
    index: int,
    count: int,
    dialogue_id: str,
) -> dict[str, Any]:
    curated_positions = {
        1: (("performance-center", 50),),
        2: (("performance-left", 22), ("performance-right", 78)),
        3: (
            ("performance-outer-left", 10),
            ("performance-center", 50),
            ("performance-outer-right", 90),
        ),
    }
    if count <= 3:
        positions = curated_positions[count]
    else:
        left = 6.0
        right = 94.0
        step = (right - left) / (count - 1)
        positions = tuple(
            (f"performance-row-{count}-{position_index + 1}", left + step * position_index)
            for position_index in range(count)
        )
    distance = (
        "near"
        if count == 1 and dialogue_id in SAFE_CLOSEUP_DIALOGUE_IDS
        else "medium"
        if count == 2
        else "far"
        if count > 2
        else "medium"
    )
    height = portrait_height_percent(document, character_id, expression_id)
    effective_height = height * DISTANCE_SCALES[distance]
    available_height = STAGE_BOTTOM_PERCENT - TOP_SAFE_PERCENT - MOTION_SAFE_PERCENT
    equal_row_scale_caps = {2: 0.92, 3: 0.60, 4: 0.72, 5: 0.62, 6: 0.54, 7: 0.47, 8: 0.42}
    scale_cap = equal_row_scale_caps.get(count, 1.0)
    character = next(
        (item for item in document.get("characters", []) if item.get("id") == character_id),
        {},
    )
    if any(name in str(character.get("name", "")) for name in ("铃羽", "鈴羽", "玲羽", "Suzuha")):
        scale_cap *= 1.12
    scale = floor(min(scale_cap, available_height / effective_height) * 1000) / 1000
    if scale < 0.25:
        raise RuntimeError(f"角色 {character_id} 的立绘过高，无法在贴底后保留安全头部")
    return {
        "characterId": character_id,
        "expressionId": expression_id,
        "distance": distance,
        "positionId": positions[index][0],
        "transform": {
            "x": positions[index][1],
            "y": STAGE_BOTTOM_PERCENT,
            "anchor": "bottomCenter",
            "scale": scale,
            "brightness": 1,
            "opacity": 1,
            "flipX": index == 1 and count > 1,
            "layer": 10 + index,
        },
        "transition": {"durationMs": 0, "fade": False},
    }


def visible_cast_for_dialogue(
    dialogues: list[dict[str, Any]],
    index: int,
    first_person_id: str,
    visible_character_ids: set[str],
) -> list[str]:
    current = dialogues[index]
    if current["id"] in Q_OVERLAY_DIALOGUE_IDS:
        return []
    if current["id"] in SAFE_CLOSEUP_DIALOGUE_IDS:
        return (
            [current["characterId"]] if current.get("characterId") in visible_character_ids else []
        )
    explicit_group = len(current.get("speakerIds") or []) > 1
    speakers = [
        speaker
        for speaker in (current.get("speakerIds") or [current.get("characterId")])
        if speaker and speaker != first_person_id and speaker in visible_character_ids
    ]
    if explicit_group:
        return []
    if current.get("characterId") not in visible_character_ids:
        return []
    previous = dialogues[index - 1] if index else None
    if speakers and previous:
        previous_speakers = [
            speaker
            for speaker in (previous.get("speakerIds") or [previous.get("characterId")])
            if speaker
            and speaker != first_person_id
            and speaker in visible_character_ids
            and speaker not in speakers
        ]
        if current["startMs"] - previous["endMs"] <= 1_200:
            speakers.extend(previous_speakers[:1])
    if not speakers:
        nearby: list[dict[str, Any]] = []
        for offset in range(1, 13):
            if index + offset < len(dialogues):
                nearby.append(dialogues[index + offset])
            if index - offset >= 0:
                nearby.append(dialogues[index - offset])
        for candidate in nearby:
            candidate_speakers = [
                speaker
                for speaker in (candidate.get("speakerIds") or [candidate.get("characterId")])
                if speaker and speaker != first_person_id and speaker in visible_character_ids
            ]
            if candidate_speakers:
                speakers = candidate_speakers
                break
    return list(dict.fromkeys(speakers))[:3]


def remembered_cast_expression(
    character_id: str,
    dialogue: dict[str, Any],
    character_by_id: dict[str, dict[str, Any]],
    last_expression_by_character: dict[str, str],
) -> str | None:
    if character_id == dialogue.get("characterId"):
        return dialogue.get("expressionId")
    return last_expression_by_character.get(character_id) or character_by_id.get(
        character_id, {}
    ).get("defaultExpressionId")


def clear_adjacent_direct_portrait_overlaps(dialogues: list[dict[str, Any]]) -> list[str]:
    cleared: list[str] = []
    for current, following in zip(dialogues, dialogues[1:], strict=False):
        current_portrait = current.get("portrait", {})
        following_portrait = following.get("portrait", {})
        if (
            current.get("characterId") != following.get("characterId")
            and current_portrait.get("visible")
            and following_portrait.get("visible")
            and current_portrait.get("positionId") == following_portrait.get("positionId")
        ):
            current_portrait["keepAfter"] = False
            cleared.append(current["id"])
    return cleared


def fullscreen_cg_at(milliseconds: int) -> dict[str, Any] | None:
    return next(
        (
            event
            for event in CG_EVENTS
            if event["displayMode"] == "fullscreen"
            and event["startMs"] <= milliseconds
            and (event["endMs"] is None or milliseconds < event["endMs"])
        ),
        None,
    )


def install_performance_blocks(document: dict[str, Any], first_person_id: str) -> None:
    from scripts.demo.galgame_runaway.performance_story import (
        install_performance_blocks as run,
    )

    run(document, first_person_id)


def audit_document(
    document: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_audit: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from scripts.demo.galgame_runaway.performance_audit import (
        audit_document as run_audit,
    )

    return run_audit(
        document,
        mapping,
        source_root,
        original_source_root,
        annotation_audit,
    )


def transform_latest_story(
    latest: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    document = deepcopy(latest["document"])
    fragment = target_fragment(document)
    baseline = {
        "revision": latest["revision"],
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueTimelineSignature": dialogue_timeline_signature(fragment),
    }
    annotation_audit = apply_annotation(document, annotation_path)
    observed_changes = (
        annotation_audit["changedTextCount"],
        annotation_audit["changedSpeakerCount"],
    )
    if observed_changes[0] not in range(0, 7) or observed_changes[1] not in range(0, 13):
        raise RuntimeError(f"新版对白变更数量异常：{observed_changes}")
    configure_dialogue_display_names(document)
    install_curated_scenes(document, mapping)
    upgrade_suzuha(document, mapping)
    install_curated_character_expressions(document, mapping, source_root)
    install_special_character_expressions(document)
    normalize_expression_labels(document)
    set_all_lip_sync_fps(document)
    enlarge_dialogue_text(document)
    first_person_id = first_person_okabe(document)["id"]
    install_performance_blocks(document, first_person_id)
    install_cgs(document, mapping)
    install_opening_declaration(document)
    install_ending_thanks(document)
    install_transition_cards(document)
    checks = audit_document(
        document,
        mapping,
        source_root,
        original_source_root,
        annotation_audit,
    )
    if (
        dialogue_timeline_signature(target_fragment(document))
        != baseline["dialogueTimelineSignature"]
    ):
        raise RuntimeError("最终审计发现对白 Block、时间或音频绑定发生变化")
    return document, {"baseline": baseline, "checks": checks}
