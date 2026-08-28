from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from contextlib import ExitStack
from copy import deepcopy
from datetime import UTC, datetime
from math import floor
from pathlib import Path
from typing import Any

import httpx

try:
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from management_api import management_api_key

try:
    from scripts.demo.galgame_runaway.cues import (
        CG_ASSETS,
        CG_EVENT_STARTS,
        CG_EVENTS,
        DISTANCE_SCALES,
        SAFE_CLOSEUP_DIALOGUE_IDS,
        TOP_SAFE_PERCENT,
    )
except ModuleNotFoundError:
    from cues import (  # type: ignore[no-redef]
        CG_ASSETS,
        CG_EVENT_STARTS,
        CG_EVENTS,
        DISTANCE_SCALES,
        SAFE_CLOSEUP_DIALOGUE_IDS,
        TOP_SAFE_PERCENT,
    )

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKUP_ROOT = REPO_ROOT / ".runtime" / "galgame-import-backups"
MAP_PATH = BACKUP_ROOT / "sg0-performance-asset-map.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
LIP_SYNC_FPS = 5
DIALOGUE_BOX_OPACITY = 0.82
EXPECTED_ANNOTATION_SHA256 = "11b11ebdf929ee9ca5b83b1f8a7d104acb1eafa624f23785caa0dc8a8b64fe79"
EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES = 2
EXPECTED_CROWD_NORMALIZED_LINES = 0
EXPECTED_STORY_MULTI_SPEAKER_LINES = 2
GROUP_CG_DIALOGUE_IDS = frozenset(
    f"runaway-annotated-line-{line:04d}"
    for line in (85, 88, 109, 117, 169, 213, 230, 257, 322, 324, 377, 426, 463, 511)
)
Q_OVERLAY_DIALOGUE_IDS = frozenset({"runaway-annotated-line-0001"})
MOTION_SAFE_PERCENT = 4.0
STAGE_BOTTOM_PERCENT = 100.0
EXPRESSION_CUES_PATH = Path(__file__).with_name("expression_cues.json")
DIALOGUE_EXPRESSION_CUES: dict[str, str] = json.loads(
    EXPRESSION_CUES_PATH.read_text(encoding="utf-8")
)
CAST_EXPRESSION_OVERRIDES = {
    "runaway-annotated-line-0050": (("牧濑红莉栖", "e009-f000"),),
}
OPENING_DECLARATION_ID = "runaway-opening-declaration"
ENDING_THANKS_ID = "runaway-ending-thanks"
ENDING_THANKS_TEXT = "谢谢观看"
OPENING_DECLARATION_TEXT = (
    "源剧情：【命运石之门0广播剧】自由粒子的逃逸\n\n"
    "本视频为up主自制的galgame版本\n"
    "字幕自己翻的（有参考一些别人的翻译版本）\n\n"
    "游戏CG小部分来自本篇和0，大部分由AI生成\n\n"
    "制作不易，大家如果看开心了可以给个三连～"
)
TRANSITION_CARD_BLOCKS = (
    {
        "id": "runaway-curtain-rooftop-show",
        "type": "curtain",
        "atMs": 368_143,
        "mode": "fullscreen",
        "action": "show",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
    {
        "id": "runaway-transition-rooftop-text",
        "type": "floatingText",
        "atMs": 368_743,
        "text": "众人前往屋顶......",
        "x": 50,
        "y": 50,
        "color": "#F5F1E8",
        "durationMs": 3_700,
    },
    {
        "id": "runaway-curtain-rooftop-hide",
        "type": "curtain",
        "atMs": 373_008,
        "mode": "fullscreen",
        "action": "hide",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
    {
        "id": "runaway-curtain-lab-show",
        "type": "curtain",
        "atMs": 450_933,
        "mode": "fullscreen",
        "action": "show",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
    {
        "id": "runaway-transition-lab-text",
        "type": "floatingText",
        "atMs": 451_633,
        "text": "众人回到lab......",
        "x": 50,
        "y": 50,
        "color": "#F5F1E8",
        "durationMs": 4_800,
    },
    {
        "id": "runaway-curtain-lab-hide",
        "type": "curtain",
        "atMs": 457_665,
        "mode": "fullscreen",
        "action": "hide",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
    {
        "id": "runaway-curtain-explanation-show",
        "type": "curtain",
        "atMs": 682_514,
        "mode": "fullscreen",
        "action": "show",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
    {
        "id": "runaway-transition-explanation-text",
        "type": "floatingText",
        "atMs": 683_114,
        "text": "玲羽和众人解释一番过后......",
        "x": 50,
        "y": 50,
        "color": "#F5F1E8",
        "durationMs": 3_358,
    },
    {
        "id": "runaway-curtain-explanation-hide",
        "type": "curtain",
        "atMs": 686_472,
        "mode": "fullscreen",
        "action": "hide",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
    {
        "id": "runaway-curtain-time-passage-show",
        "type": "curtain",
        "atMs": 1_219_752,
        "mode": "fullscreen",
        "action": "show",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 450,
    },
    {
        "id": "runaway-transition-time-passage-text",
        "type": "floatingText",
        "atMs": 1_220_202,
        "text": "过去一段时间以后......",
        "x": 50,
        "y": 50,
        "color": "#F5F1E8",
        "durationMs": 2_049,
    },
    {
        "id": "runaway-curtain-time-passage-hide",
        "type": "curtain",
        "atMs": 1_222_251,
        "mode": "fullscreen",
        "action": "hide",
        "color": "#000000",
        "opacity": 1,
        "durationMs": 600,
    },
)

LIBRARY_GROUPS = (
    ("backgrounds/scenes", "scene"),
    ("cg/event", "cg"),
    ("backgrounds/inserts", "cg"),
)

CURATED_SCENES = (
    ("BG03A1", "实验室日常", 1.0),
    ("BG03A2", "实验室设备亮起", 0.9),
    ("BG03A4", "实验室整理中", 0.95),
    ("BG03A5", "实验室另一角度", 1.15),
    ("BG11A2", "关闭的时间机器", 0.92),
    ("BG11A7", "时间机器舱门开启", 0.92),
    ("BG11A8", "时间机器登舱梯", 1.05),
)

ORIGINAL_SG_SCENES = (
    ("BG01A", "Lab 客厅·白昼", 1.0),
    ("BG01E", "Lab 客厅·黄昏", 1.0),
    ("BG01N", "Lab 客厅·夜晚", 1.0),
    ("BG02A1", "Lab 沙发区·白昼", 1.0),
    ("BG02A2", "Lab 沙发区·白昼·窗帘关闭", 1.0),
    ("BG02E1", "Lab 沙发区·黄昏", 1.0),
    ("BG02E2", "Lab 沙发区·黄昏·窗帘关闭", 1.0),
    ("BG02N1", "Lab 沙发区·夜晚", 1.0),
    ("BG02N2", "Lab 沙发区·夜晚·窗帘关闭", 1.0),
    ("BG02AS1", "Lab 沙发区局部·白昼·左", 1.0),
    ("BG02AS2", "Lab 沙发区局部·白昼·右", 1.0),
    ("BG02ES1", "Lab 沙发区局部·黄昏·左", 1.0),
    ("BG02ES2", "Lab 沙发区局部·黄昏·右", 1.0),
    ("BG02NS1", "Lab 沙发区局部·夜晚·左", 1.0),
    ("BG02NS2", "Lab 沙发区局部·夜晚·右", 1.0),
)

CUSTOM_SCENES = (
    {
        "code": "BG11A7_TWO",
        "name": "双时光机屋顶",
        "description": "基于原作 BG11A7 补全铃羽第二台时光机的屋顶场景。",
        "path": REPO_ROOT / "docs/assets/galgame-runaway-scenes/BG11A7-two-time-machines-v1.png",
        "relative": "project-scenes/BG11A7-two-time-machines-v1.png",
        "distance": 0.92,
    },
    {
        "code": "BG11_EMPTY",
        "name": "跃迁后的平整空天台",
        "description": "基于原作 BG11A7 移除时光机器并补全为无裂纹、无残骸的平整屋顶。",
        "path": REPO_ROOT / "docs/assets/galgame-runaway-scenes/BG11-empty-rooftop-v1.png",
        "relative": "project-scenes/BG11-empty-rooftop-v1.png",
        "distance": 1.0,
    },
)

SCENE_BEATS = (
    (0, "SG_BG01A"),
    (151_754, "SG_BG02A2"),
    (372_443, "BG11A2"),
    (387_752, "BG11A7"),
    (456_433, "SG_BG01A"),
    (686_472, "SG_BG02A2"),
    (970_000, "SG_BG01E"),
    (1_188_000, "SG_BG02E2"),
    (1_300_000, "SG_BG01N"),
    (1_364_000, "SG_BG02N2"),
    (1_627_170, "BG11A7"),
    (1_677_392, "BG11_EMPTY"),
)

HIDDEN_SCENE_SWITCH_MS = frozenset({372_443, 456_433, 686_472})

SUZUHA_VARIANTS = {
    "calm": ("SUZ_HSD", "001"),
    "cheerful": ("SUZ_HSD", "002"),
    "serious": ("SUZ_HSD", "005"),
    "worried": ("SUZ_HSD", "007"),
    "strict": ("SUZ_HSE", "001"),
    "relieved": ("SUZ_HSE", "006"),
}
SUZUHA_CROP_ROOT = REPO_ROOT / "docs/assets/galgame-runaway-portraits/suzuha-half-v1"

# 红莉栖的三个姿势并不共享表情序号。同一个 e00x 在不同姿势里可能分别是
# 眨眼、闭眼微笑或生气，不能按基础站姿的顺序套用名称。这里集中保存逐张
# 对照原图后的名称，供素材导入、线上修正与回归测试共用。
KURISU_EXPRESSION_LABELS = {
    "e001-f000": "白衬衫站姿·平静",
    "e002-f000": "白衬衫站姿·眨眼微笑",
    "e003-f000": "白衬衫站姿·撇嘴不悦",
    "e004-f000": "白衬衫站姿·担忧",
    "e005-f000": "白衬衫站姿·低落",
    "e006-f000": "白衬衫站姿·闭眼微笑",
    "e007-f000": "白衬衫站姿·皱眉不悦",
    "e008-f000": "白衬衫站姿·皱眉生气",
    "e009-f000": "白衬衫站姿·脸红害羞",
    "crs-alb-e001-f000": "抱臂·浅笑",
    "crs-alb-e002-f000": "抱臂·眨眼微笑",
    "crs-alb-e003-f000": "抱臂·撇嘴不满",
    "crs-alb-e004-f000": "抱臂·皱眉生气",
    "crs-alb-e005-f000": "抱臂·担忧",
    "crs-alb-e006-f000": "抱臂·不悦",
    "crs-alb-e007-f000": "抱臂·低落",
    "crs-alb-e008-f000": "抱臂·闭眼微笑",
    "crs-alb-e009-f000": "抱臂·脸红害羞",
    "crs-alc-e001-f000": "手扶领带·认真",
    "crs-alc-e002-f000": "手扶领带·脸红害羞",
    "crs-alc-e003-f000": "手扶领带·闭眼微笑",
    "crs-alc-e004-f000": "手扶领带·担忧",
    "crs-alc-e005-f000": "手扶领带·严肃",
    "crs-alc-e006-f000": "手扶领带·惊讶",
}

CURATED_CHARACTER_POSES = (
    {
        "characterNames": ("牧濑红莉栖",),
        "sourceDirectory": "makise_kurisu",
        "poses": (
            {
                "code": "CRS_ALB",
                "labels": tuple(
                    KURISU_EXPRESSION_LABELS[f"crs-alb-e{variant:03d}-f000"]
                    for variant in range(1, 10)
                ),
            },
            {
                "code": "CRS_ALC",
                "labels": tuple(
                    KURISU_EXPRESSION_LABELS[f"crs-alc-e{variant:03d}-f000"]
                    for variant in range(1, 7)
                ),
            },
        ),
    },
    {
        "characterNames": ("椎名真由理",),
        "sourceDirectory": "shiina_mayuri",
        "poses": (
            {
                "code": "MAY_ALB",
                "labels": ("抬手·温柔", "抬手·惊讶", "抬手·平静", "抬手·难过"),
            },
            {
                "code": "MAY_ALC",
                "labels": (
                    "双手交握·担忧",
                    "双手交握·惊讶",
                    "双手交握·脸红害羞",
                    "双手交握·含泪悲伤",
                ),
            },
        ),
    },
    {
        "characterNames": ("桥田至",),
        "sourceDirectory": "hashida_itaru",
        "poses": (
            {
                "code": "DAR_ALB",
                "labels": (
                    "正面站姿·平静",
                    "正面站姿·浅笑",
                    "正面站姿·担忧",
                    "正面站姿·惊讶",
                    "正面站姿·严肃",
                    "正面站姿·闭眼沮丧",
                ),
            },
        ),
    },
    {
        "characterNames": ("菲莉丝",),
        "sourceDirectory": "faris_nyannyan",
        "replacePrimary": True,
        "poses": (
            {
                "code": "FEI_DLA",
                "labels": (
                    "米色私服站姿·眨眼微笑",
                    "米色私服站姿·闭眼微笑",
                    "米色私服站姿·皱眉不悦",
                    "米色私服站姿·脸红害羞",
                ),
            },
            {
                "code": "FEI_DLB",
                "labels": ("交握双手·微笑", "交握双手·脸红微笑", "交握双手·担忧"),
            },
            {
                "code": "FEI_DLC",
                "labels": (
                    "正面站姿·微笑",
                    "正面站姿·惊讶",
                    "正面站姿·严肃",
                    "正面站姿·不悦",
                    "正面站姿·含泪难过",
                ),
            },
        ),
    },
    {
        "characterNames": ("漆原琉华",),
        "sourceDirectory": "urushibara_luka",
        "replacePrimary": True,
        "poses": (
            {
                "code": "RUK_CLA",
                "labels": (
                    "黑色私服站姿·温柔",
                    "黑色私服站姿·含泪悲伤",
                    "黑色私服站姿·脸红不安",
                    "黑色私服站姿·闭眼哭泣",
                    "黑色私服站姿·脸红害羞",
                    "黑色私服站姿·睁眼微笑",
                ),
            },
            {
                "code": "RUK_CLB",
                "labels": (
                    "手抚衣领·温柔",
                    "手抚衣领·担忧",
                    "手抚衣领·脸红害羞",
                    "手抚衣领·惊讶",
                    "手抚衣领·微笑",
                ),
            },
        ),
    },
    {
        "characterNames": ("桐生萌郁",),
        "sourceDirectory": "kiryu_moeka",
        "poses": (
            {
                "code": "MOE_ALB",
                "labels": (
                    "正面站姿·冷淡",
                    "正面站姿·疲惫",
                    "正面站姿·低落",
                    "正面站姿·担忧",
                    "正面站姿·不悦",
                ),
            },
        ),
    },
    {
        "characterNames": ("铃羽", "鈴羽", "玲羽", "Suzuha"),
        "sourceDirectory": "amane_suzuha",
        "poses": (
            {
                "code": "SUZ_HMD",
                "labels": (
                    "站姿·平静",
                    "站姿·眨眼微笑",
                    "站姿·认真",
                    "站姿·浅笑",
                    "站姿·不悦",
                    "站姿·含泪难过",
                    "站姿·生气",
                    "站姿·闭眼难过",
                    "站姿·担忧",
                ),
            },
            {
                "code": "SUZ_HME",
                "labels": (
                    "抱臂·平静",
                    "抱臂·浅笑",
                    "抱臂·认真",
                    "抱臂·皱眉生气",
                    "抱臂·担忧",
                    "抱臂·闭眼沉思",
                ),
            },
        ),
    },
    {
        "characterNames": ("冈部篝", "幼年篝"),
        "sourceDirectory": "shiina_kagari",
        "poses": (
            {
                "code": "KAG_ALB",
                "labels": (
                    "双手交握·睁眼微笑",
                    "双手交握·担忧",
                    "双手交握·悲伤",
                    "双手交握·皱眉不悦",
                    "双手交握·闭眼微笑",
                ),
            },
        ),
    },
    {
        "characterNames": ("比屋定真帆",),
        "sourceDirectory": "hiyajo_maho",
        "poses": (
            {
                "code": "MAH_ALB",
                "labels": (
                    "双手交握·自信",
                    "双手交握·温柔",
                    "双手交握·俏皮",
                    "双手交握·生气",
                    "双手交握·严肃",
                    "双手交握·脸红害羞",
                    "双手交握·惊讶",
                    "双手交握·闭眼悲伤",
                    "双手交握·闭眼微笑",
                ),
            },
        ),
    },
    {
        "characterNames": ("天王寺裕吾",),
        "sourceDirectory": "tennoji_yugo",
        "poses": (
            {
                "code": "TEN_BLA",
                "labels": ("围裙正面站姿·平静", "围裙正面站姿·严肃", "围裙正面站姿·担忧"),
            },
        ),
    },
)

CURATED_EXPRESSION_OVERRIDES = {
    "kurisu-makise": {
        "e003-f000": "crs-alb-e003-f000",
        "e004-f000": "crs-alb-e004-f000",
        "e005-f000": "crs-alc-e004-f000",
        "e006-f000": "crs-alc-e002-f000",
        "e007-f000": "crs-alb-e007-f000",
        "e008-f000": "crs-alb-e008-f000",
        "e009-f000": "crs-alc-e006-f000",
    },
    "mayuri": {
        "e003-f000": "may-alc-e001-f000",
        "e004-f000": "may-alc-e004-f000",
    },
    "daru": {
        "e002-f000": "dar-alb-e002-f000",
        "e004-f000": "dar-alb-e004-f000",
        "e005-f000": "dar-alb-e005-f000",
        "e006-f000": "dar-alb-e006-f000",
    },
    "faris": {
        "e002-f000": "fei-dlb-e002-f000",
        "e003-f000": "fei-dlc-e003-f000",
        "e004-f000": "fei-dlc-e004-f000",
    },
    "luka": {
        "e004-f000": "ruk-clb-e004-f000",
        "e005-f000": "ruk-clb-e005-f000",
    },
    "moeka": {
        "e002-f000": "moe-alb-e002-f000",
        "e004-f000": "moe-alb-e004-f000",
        "e005-f000": "moe-alb-e005-f000",
    },
    "suzuha": {
        "e001-f000": "suz-hmd-e001-f000",
        "e002-f000": "suz-hmd-e002-f000",
        "e003-f000": "suz-hme-e003-f000",
        "e004-f000": "suz-hme-e005-f000",
        "e005-f000": "suz-hme-e004-f000",
        "e006-f000": "suz-hmd-e004-f000",
    },
    "kagari": {
        "e001-f000": "kag-alb-e001-f000",
        "e002-f000": "kag-alb-e005-f000",
        "e003-f000": "kag-alb-e002-f000",
        "e004-f000": "kag-alb-e004-f000",
        "e005-f000": "kag-alb-e003-f000",
    },
    "maho": {
        "e001-f000": "mah-alb-e001-f000",
        "e002-f000": "mah-alb-e003-f000",
        "e003-f000": "mah-alb-e004-f000",
        "e004-f000": "mah-alb-e005-f000",
        "e005-f000": "mah-alb-e007-f000",
        "e006-f000": "mah-alb-e002-f000",
        "e007-f000": "mah-alb-e004-f000",
        "e008-f000": "mah-alb-e007-f000",
        "e009-f000": "mah-alb-e006-f000",
    },
    "yuugo": {
        "e001-f000": "ten-bla-e001-f000",
        "e002-f000": "ten-bla-e002-f000",
        "e003-f000": "ten-bla-e003-f000",
    },
}

POSE_HOLD_SPEAKING_TURNS = 2
PERFORMANCE_POSE_CANDIDATES = {
    "kurisu-makise": {
        "e001-f000": ("e001-f000", "crs-alb-e001-f000", "crs-alc-e001-f000"),
        "e002-f000": ("e002-f000", "crs-alb-e002-f000"),
        "e003-f000": ("crs-alb-e003-f000", "crs-alc-e003-f000", "e003-f000"),
        "e004-f000": ("crs-alb-e004-f000", "e004-f000"),
        "e005-f000": ("crs-alc-e004-f000", "crs-alb-e005-f000", "e005-f000"),
        "e006-f000": ("crs-alc-e002-f000", "crs-alb-e006-f000", "e006-f000"),
        "e007-f000": ("crs-alb-e007-f000", "crs-alc-e005-f000", "e007-f000"),
        "e008-f000": ("crs-alb-e008-f000", "e008-f000"),
        "e009-f000": ("crs-alc-e006-f000", "crs-alb-e009-f000", "e009-f000"),
    },
    "mayuri": {
        "e001-f000": ("e001-f000", "may-alb-e001-f000"),
        "e002-f000": ("e002-f000", "may-alb-e002-f000"),
        "e003-f000": ("may-alc-e001-f000", "may-alb-e003-f000", "e003-f000"),
        "e004-f000": ("may-alc-e004-f000", "may-alb-e004-f000", "e004-f000"),
        "e005-f000": ("e005-f000", "may-alc-e004-f000"),
        "e010-f000": ("e010-f000",),
    },
    "daru": {
        **{
            f"e{variant:03d}-f000": (
                f"dar-alb-e{variant:03d}-f000",
                f"e{variant:03d}-f000",
            )
            for variant in range(1, 7)
        },
    },
    "faris": {
        "e001-f000": ("e001-f000", "fei-dlb-e001-f000", "fei-dlc-e001-f000"),
        "e002-f000": ("e002-f000", "fei-dlb-e002-f000", "fei-dlc-e002-f000"),
        "e003-f000": ("e003-f000", "fei-dlb-e003-f000", "fei-dlc-e003-f000"),
        "e004-f000": ("e004-f000", "fei-dlc-e004-f000"),
    },
    "luka": {
        **{
            f"e{variant:03d}-f000": (
                f"e{variant:03d}-f000",
                f"ruk-clb-e{variant:03d}-f000",
            )
            for variant in range(1, 6)
        },
        "e006-f000": ("e006-f000",),
    },
    "moeka": {
        **{
            f"e{variant:03d}-f000": (
                f"moe-alb-e{variant:03d}-f000",
                f"e{variant:03d}-f000",
            )
            for variant in range(1, 6)
        },
    },
    "suzuha": {
        "e001-f000": ("e001-f000", "suz-hmd-e001-f000", "suz-hme-e001-f000"),
        "e002-f000": ("e002-f000", "suz-hmd-e002-f000", "suz-hmd-e004-f000"),
        "e003-f000": ("e003-f000", "suz-hmd-e003-f000", "suz-hme-e003-f000"),
        "e004-f000": ("e004-f000", "suz-hmd-e009-f000", "suz-hme-e005-f000"),
        "e005-f000": ("e005-f000", "suz-hmd-e007-f000", "suz-hme-e004-f000"),
        "e006-f000": ("e006-f000", "suz-hmd-e004-f000", "suz-hme-e002-f000"),
    },
    "kagari": {
        "e001-f000": ("e001-f000",),
        "e002-f000": ("e002-f000", "kag-alb-e001-f000", "kag-alb-e005-f000"),
        "e003-f000": ("e003-f000", "kag-alb-e002-f000"),
        "e004-f000": ("e004-f000", "kag-alb-e004-f000"),
        "e005-f000": ("e005-f000", "kag-alb-e003-f000"),
        "e006-f000": ("e006-f000",),
        "e007-f000": ("e007-f000", "kag-alb-e005-f000"),
    },
    "maho": {
        "e001-f000": ("e001-f000", "mah-alb-e001-f000"),
        "e002-f000": ("e002-f000", "mah-alb-e003-f000"),
        "e003-f000": ("e003-f000", "mah-alb-e004-f000"),
        "e004-f000": ("e004-f000", "mah-alb-e005-f000"),
        "e005-f000": ("e005-f000", "mah-alb-e007-f000"),
        "e006-f000": ("e006-f000", "mah-alb-e002-f000", "mah-alb-e009-f000"),
        "e007-f000": ("e007-f000", "mah-alb-e004-f000"),
        "e008-f000": ("e008-f000", "mah-alb-e007-f000"),
        "e009-f000": ("e009-f000", "mah-alb-e006-f000"),
        "e010-f000": ("e010-f000", "mah-alb-e009-f000"),
        "e011-f000": ("e011-f000",),
        "e012-f000": ("e012-f000", "mah-alb-e008-f000"),
    },
    "yuugo": {
        **{
            f"e{variant:03d}-f000": (
                f"ten-bla-e{variant:03d}-f000",
                f"e{variant:03d}-f000",
            )
            for variant in range(1, 4)
        },
    },
}

# 表情名称直接描述画面中的服装、姿势、眼睛状态与面部特征。剧情编排与
# 快速修改都依赖这些名称，因此不能使用“释然”一类无法从画面验证的推断词。
EXPRESSION_LABEL_OVERRIDES = {
    "kurisu-makise": KURISU_EXPRESSION_LABELS,
    "mayuri": {
        "e001-f000": "帽子站姿·温柔",
        "e002-f000": "帽子站姿·闭眼微笑",
        "e003-f000": "帽子站姿·担忧",
        "e004-f000": "帽子站姿·难过",
        "e005-f000": "帽子站姿·含泪悲伤",
        "e010-f000": "双手交握·脸红害羞",
    },
    "daru": {
        "e001-f000": "抱臂站姿·平静",
        "e002-f000": "抱臂站姿·浅笑",
        "e003-f000": "抱臂站姿·担忧",
        "e004-f000": "抱臂站姿·惊讶",
        "e005-f000": "抱臂站姿·严肃",
        "e006-f000": "抱臂站姿·闭眼沮丧",
    },
    "suzuha": {
        "e001-f000": "蓝色马甲站姿·平静",
        "e002-f000": "蓝色马甲站姿·闭眼微笑",
        "e003-f000": "蓝色马甲站姿·认真",
        "e004-f000": "蓝色马甲站姿·担忧",
        "e005-f000": "蓝色马甲抱臂·严肃",
        "e006-f000": "蓝色马甲抱臂·闭眼沉思",
    },
    "kagari": {
        "e001-f000": "水手服站姿·睁眼微笑",
        "e002-f000": "水手服站姿·闭眼笑容",
        "e003-f000": "水手服站姿·担忧",
        "e004-f000": "水手服站姿·生气",
        "e005-f000": "水手服站姿·含泪悲伤",
        "e006-f000": "水手服站姿·惊讶",
        "e007-f000": "水手服站姿·闭眼微笑",
    },
    "maho": {
        "e001-f000": "单手横放·冷静自信",
        "e002-f000": "单手横放·俏皮眨眼",
        "e003-f000": "单手横放·强烈不满",
        "e004-f000": "单手横放·严肃",
        "e005-f000": "单手横放·无奈",
        "e006-f000": "单手横放·闭眼笑容",
        "e007-f000": "单手横放·生气",
        "e008-f000": "单手横放·赌气",
        "e009-f000": "单手横放·脸红害羞",
        "e010-f000": "单手横放·闭眼微笑",
        "e011-f000": "单手横放·担忧",
        "e012-f000": "单手横放·含泪悲伤",
    },
    "moeka": {
        "e001-f000": "持手机侧身·冷淡",
        "e002-f000": "持手机侧身·疲惫",
        "e003-f000": "持手机侧身·闭眼沉思",
        "e004-f000": "持手机侧身·担忧",
        "e005-f000": "持手机侧身·不悦",
    },
    "yuugo": {
        "e001-f000": "围裙站姿·平静",
        "e002-f000": "围裙站姿·严肃",
        "e003-f000": "围裙站姿·担忧",
    },
    "okabe-rintarou-main": {
        "confident": "白大褂正面·自信",
        "maniac-laugh": "白大褂正面·狂气大笑",
        "annoyed": "白大褂正面·不悦",
        "surprised": "白大褂正面·惊讶",
        "serious": "白大褂正面·严肃",
        "concerned": "白大褂正面·担忧",
        "closed-eyes-smile": "白大褂正面·闭眼微笑",
    },
    "okabe-rintarou": {
        "e001-f000": "白大褂站姿·冷静",
        "e002-f000": "白大褂站姿·苦笑",
        "e003-f000": "白大褂站姿·不悦",
        "e004-f000": "白大褂站姿·担忧",
        "e005-f000": "白大褂站姿·惊讶",
        "e006-f000": "白大褂站姿·愤怒",
        "e007-f000": "白大褂站姿·悲伤",
        "e008-f000": "白大褂站姿·闭眼沉思",
    },
}


def suzuha_crop_entry(pose: str, variant: str, mouth: int) -> tuple[Path, str]:
    filename = f"{pose}-{variant}-{mouth:03d}.png"
    return SUZUHA_CROP_ROOT / filename, f"project-portraits/suzuha-half-v1/{filename}"


def curated_portrait_entry(
    source_root: Path, source_directory: str, pose: str, variant: int, mouth: int
) -> tuple[Path, str]:
    relative = (
        f"characters/{source_directory}/sprites/variants/{pose}/"
        f"type_40_depends_{variant:03d}_{mouth:03d}.png"
    )
    return source_root / relative, relative


def curated_expression_id(pose: str, variant: int) -> str:
    return f"{pose.lower().replace('_', '-')}-e{variant:03d}-f000"


CURATED_CHARACTER_IDS_BY_SOURCE_DIRECTORY = {
    "makise_kurisu": "kurisu-makise",
    "shiina_mayuri": "mayuri",
    "hashida_itaru": "daru",
    "faris_nyannyan": "faris",
    "urushibara_luka": "luka",
    "kiryu_moeka": "moeka",
    "amane_suzuha": "suzuha",
    "shiina_kagari": "kagari",
    "hiyajo_maho": "maho",
    "tennoji_yugo": "yuugo",
}


def build_audited_expression_labels() -> dict[str, dict[str, str]]:
    labels = deepcopy(EXPRESSION_LABEL_OVERRIDES)
    for character_spec in CURATED_CHARACTER_POSES:
        character_id = CURATED_CHARACTER_IDS_BY_SOURCE_DIRECTORY[character_spec["sourceDirectory"]]
        character_labels = labels.setdefault(character_id, {})
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
                character_labels[expression_id] = label
    return labels


AUDITED_EXPRESSION_LABELS = build_audited_expression_labels()


class ApiError(RuntimeError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过正式 API 导入 SG0 素材并重做目标广播剧演出")
    parser.add_argument(
        "action",
        choices=(
            "inspect",
            "rename-kurisu",
            "rename-expressions",
            "upload",
            "apply",
            "audit",
            "all",
        ),
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--original-source-root", type=Path, required=True)
    parser.add_argument("--annotation", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--batch-size", type=int, default=12)
    return parser.parse_args()


def timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S.%fZ")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n" or len(header) < 24:
        raise RuntimeError(f"不是可识别的 PNG 素材：{path}")
    return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    files: list[tuple[str, tuple[str, Any, str]]] | None = None,
    data: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = client.request(method, path, json=payload, files=files, data=data)
    if response.is_error:
        raise ApiError(
            f"API {method} {path} 返回 {response.status_code}: {response.text[:2000]}",
            response.status_code,
        )
    return response.json()


def project_path(project_id: str, suffix: str) -> str:
    return f"/v1/galgame-workshop/projects/{project_id}{suffix}"


def scene_id_for_code(code: str) -> str:
    if code.startswith("SG_"):
        return f"sg-{code.removeprefix('SG_').lower().replace('_', '-')}"
    return f"sg0-{code.lower().replace('_', '-')}"


def scene_asset_id_for_code(code: str) -> str:
    if code.startswith("SG_"):
        return f"{scene_id_for_code(code)}-scene"
    return f"sg0-scene-{code.lower().replace('_', '-')}"


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
    fragment = target_fragment(document)
    original_signature = dialogue_signature(fragment)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    if len(dialogues) != 514:
        raise RuntimeError(f"目标时间轴对白应为 514 条，实际为 {len(dialogues)} 条")
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    visible_character_ids = {
        character["id"]
        for character in document.get("characters", [])
        if character.get("expressions") and character["id"] != first_person_id
    }
    group_character_id = find_character(document, ("众人",))["id"]
    removed_types = {
        "scene",
        "showCharacter",
        "setStageCast",
        "removeCharacter",
        "camera",
        "resetCamera",
        "animateSprite",
        "curtain",
    }
    retained = [
        block for block in fragment.get("blocks", []) if block.get("type") not in removed_types
    ]
    performance: list[dict[str, Any]] = []
    for beat_index, (at_ms, scene_code) in enumerate(SCENE_BEATS):
        hidden_scene_switch = at_ms in HIDDEN_SCENE_SWITCH_MS
        scene_transition_ms = (
            0
            if beat_index == 0 or hidden_scene_switch or at_ms in CG_EVENT_STARTS
            else 450
            if at_ms == 387_752
            else 350
        )
        performance.append(
            {
                "id": f"perf-scene-{beat_index:02d}",
                "type": "scene",
                "atMs": at_ms,
                "sceneId": scene_id_for_code(scene_code),
                "clearCharacters": True,
                "transition": {
                    "durationMs": scene_transition_ms,
                    "fade": scene_transition_ms > 0,
                },
            }
        )
        if beat_index:
            performance.append(
                {
                    "id": f"perf-camera-{beat_index:02d}",
                    "type": "camera",
                    "atMs": at_ms,
                    "target": "background",
                    "effect": "move" if beat_index % 3 else "zoomIn",
                    "x": (-2 if beat_index % 2 else 2),
                    "y": -1 if beat_index % 2 else 0,
                    "scale": 1 if beat_index % 4 == 3 else 1.04 + (beat_index % 3) * 0.025,
                    "rotation": 0,
                    "intensity": 0.5,
                    "durationMs": 5_000,
                    "easing": "easeInOut",
                    "waitForCompletion": False,
                }
            )

    last_expression_by_character: dict[str, str] = {}
    speaking_turn_by_character: dict[str, int] = {}
    motion_block_count = 0
    motion_block_limit = 24
    for cue_index, dialogue in enumerate(dialogues):
        character_id = dialogue.get("characterId")
        if character_id in visible_character_ids:
            try:
                speaking_turn = speaking_turn_by_character.get(character_id, 0)
                dialogue["expressionId"] = performance_expression_for_turn(
                    character_id,
                    DIALOGUE_EXPRESSION_CUES[dialogue["id"]],
                    speaking_turn,
                )
            except KeyError as exc:
                raise RuntimeError(f"对白缺少显式表情：{dialogue['id']}") from exc
            speaking_turn_by_character[character_id] = speaking_turn + 1
            last_expression_by_character[character_id] = dialogue["expressionId"]
        else:
            dialogue.pop("expressionId", None)
        for character_name, expression_id in CAST_EXPRESSION_OVERRIDES.get(dialogue["id"], ()):
            override_character_id = find_character(document, (character_name,))["id"]
            last_expression_by_character[override_character_id] = performance_expression_id(
                override_character_id, expression_id
            )
        visible_ids = visible_cast_for_dialogue(
            dialogues, cue_index, first_person_id, visible_character_ids
        )
        members: list[dict[str, Any]] = []
        for member_index, character_id in enumerate(visible_ids):
            expression_id = remembered_cast_expression(
                character_id,
                dialogue,
                character_by_id,
                last_expression_by_character,
            )
            members.append(
                cast_member(
                    document,
                    character_id,
                    expression_id,
                    member_index,
                    len(visible_ids),
                    dialogue["id"],
                )
            )
        explicit_group = len(dialogue.get("speakerIds") or []) > 1
        group_dialogue = explicit_group or dialogue.get("characterId") == group_character_id
        fullscreen_cg = fullscreen_cg_at(dialogue["startMs"])
        cg_hidden_dialogue = (
            group_dialogue or dialogue["id"] in Q_OVERLAY_DIALOGUE_IDS or fullscreen_cg is not None
        )
        requires_composition = (
            dialogue["characterId"] not in visible_character_ids
            or cg_hidden_dialogue
            or len(visible_ids) > 1
            or dialogue["id"] in SAFE_CLOSEUP_DIALOGUE_IDS
        )
        if requires_composition:
            cast_at_ms = dialogue["startMs"]
            if fullscreen_cg and fullscreen_cg["startMs"] == dialogue["startMs"]:
                # Keep the previous stage intact while the CG fades in. The new
                # cast is installed only once the CG is fully opaque, preventing
                # a one-frame portrait flash at every CG/dialogue boundary.
                cast_at_ms += fullscreen_cg["transitionMs"]
            performance.append(
                {
                    "id": f"perf-cast-{cue_index:03d}",
                    "type": "setStageCast",
                    "atMs": cast_at_ms,
                    "members": members,
                    "exitTransition": {"durationMs": 0, "fade": False},
                }
            )

        if requires_composition:
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": False,
                "distance": "medium",
                "keepAfter": True,
                "transition": {"durationMs": 0, "fade": False},
            }
        else:
            speaker_member = next(
                (member for member in members if member["characterId"] == dialogue["characterId"]),
                cast_member(
                    document,
                    dialogue["characterId"],
                    dialogue.get("expressionId"),
                    0,
                    1,
                    dialogue["id"],
                ),
            )
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": True,
                "distance": speaker_member["distance"],
                "positionId": speaker_member["positionId"],
                "keepAfter": True,
                "transform": speaker_member["transform"],
                "transition": {"durationMs": 0, "fade": False},
            }

        text = dialogue.get("text", "")
        if visible_ids and cue_index % 18 == 0 and motion_block_count < motion_block_limit:
            animation = (
                "startle"
                if any(mark in text for mark in ("！", "!"))
                else "lean"
                if any(mark in text for mark in ("？", "?"))
                else "nod"
            )
            performance.append(
                {
                    "id": f"perf-motion-{cue_index:03d}-0",
                    "type": "animateSprite",
                    "atMs": min(dialogue["endMs"] - 1, dialogue["startMs"] + 180),
                    "characterId": visible_ids[0],
                    "animation": animation,
                    "direction": "towardCenter",
                    "intensity": 0.8,
                    "easing": "easeOut",
                    "durationMs": 520,
                    "loop": False,
                    "waitForCompletion": False,
                }
            )
            motion_block_count += 1
        if (
            len(visible_ids) >= 2
            and 1_364_000 <= dialogue["startMs"] <= 1_604_000
            and cue_index % 11 == 0
            and motion_block_count < motion_block_limit
        ):
            for member_index, character_id in enumerate(visible_ids[:2]):
                if motion_block_count >= motion_block_limit:
                    break
                performance.append(
                    {
                        "id": f"perf-motion-{cue_index:03d}-{member_index + 1}",
                        "type": "animateSprite",
                        "atMs": min(dialogue["endMs"] - 1, dialogue["startMs"] + 220),
                        "characterId": character_id,
                        "animation": "tug",
                        "direction": "right" if member_index == 0 else "left",
                        "intensity": 0.65,
                        "easing": "easeInOut",
                        "durationMs": 680,
                        "loop": False,
                        "waitForCompletion": False,
                    }
                )
                motion_block_count += 1
    clear_adjacent_direct_portrait_overlaps(dialogues)
    dialogues[-1]["hideDialogueAfter"] = True
    fragment["blocks"] = [*performance, *retained]
    if len(fragment["blocks"]) > 1000:
        raise RuntimeError(f"演出 Block 超过上限：{len(fragment['blocks'])}")
    if dialogue_signature(fragment) != original_signature:
        raise RuntimeError("演出重编意外修改了对白文本或时间轴")


def audit_document(
    document: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_audit: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fragment = target_fragment(document)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    first_person_id = first_person_okabe(document)["id"]
    cast_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "setStageCast"
    ]
    lip_sync_fps = [
        expression["sequence"]["fps"]
        for character in document.get("characters", [])
        for expression in character.get("expressions", [])
        if expression.get("sequence", {}).get("playbackMode") == "lipSync"
    ]
    scene_blocks = [block for block in fragment.get("blocks", []) if block.get("type") == "scene"]
    camera_blocks = [block for block in fragment.get("blocks", []) if block.get("type") == "camera"]
    curtain_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "curtain"
    ]
    stage_events = sorted(
        [
            block
            for block in fragment.get("blocks", [])
            if block.get("type") in {"scene", "setStageCast"} and block.get("atMs") is not None
        ],
        key=lambda block: (block["atMs"], 0 if block["type"] == "scene" else 1),
    )

    def cast_at(milliseconds: int) -> list[dict[str, Any]]:
        members: list[dict[str, Any]] = []
        for event in stage_events:
            if event["atMs"] > milliseconds:
                break
            if event["type"] == "scene" and event.get("clearCharacters", True):
                members = []
            elif event["type"] == "setStageCast":
                members = event.get("members", [])
        return members

    silent_gaps = [
        (dialogues[index]["endMs"], dialogues[index + 1]["startMs"])
        for index in range(len(dialogues) - 1)
        if dialogues[index + 1]["startMs"] - dialogues[index]["endMs"] > 80
    ]
    nonempty_silent_gaps = [
        (start, end) for start, end in silent_gaps if cast_at(start + (end - start) // 2)
    ]
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    visible_character_ids = {
        character_id
        for character_id, character in character_by_id.items()
        if character.get("expressions") and character_id != first_person_id
    }
    expression_dialogues = [
        dialogue for dialogue in dialogues if dialogue.get("characterId") in visible_character_ids
    ]
    group_dialogues = [
        dialogue for dialogue in dialogues if dialogue["id"] in GROUP_CG_DIALOGUE_IDS
    ]
    q_overlay_dialogues = [
        dialogue for dialogue in dialogues if dialogue["id"] in Q_OVERLAY_DIALOGUE_IDS
    ]
    visually_hidden_dialogue_ids = GROUP_CG_DIALOGUE_IDS | Q_OVERLAY_DIALOGUE_IDS
    visible_dialogues = [
        dialogue
        for dialogue in expression_dialogues
        if dialogue["id"] not in visually_hidden_dialogue_ids
    ]
    hidden_dialogues = [
        dialogue
        for dialogue in dialogues
        if dialogue.get("characterId") not in visible_character_ids
        and dialogue["id"] not in visually_hidden_dialogue_ids
    ]
    expression_ids = {
        character_id: {expression["id"] for expression in character.get("expressions", [])}
        for character_id, character in character_by_id.items()
    }
    expression_label_mismatches = [
        {
            "characterId": character_id,
            "expressionId": expression_id,
            "expected": expected,
            "actual": next(
                (
                    expression.get("label")
                    for expression in character_by_id.get(character_id, {}).get("expressions", [])
                    if expression.get("id") == expression_id
                ),
                None,
            ),
        }
        for character_id, labels in EXPRESSION_LABEL_OVERRIDES.items()
        for expression_id, expected in labels.items()
        if next(
            (
                expression.get("label")
                for expression in character_by_id.get(character_id, {}).get("expressions", [])
                if expression.get("id") == expression_id
            ),
            None,
        )
        != expected
    ]
    ambiguous_expression_labels = [
        {
            "characterId": character_id,
            "expressionId": expression.get("id"),
            "label": expression.get("label"),
        }
        for character_id, character in character_by_id.items()
        for expression in character.get("expressions", [])
        if "·" not in str(expression.get("label") or "")
    ]
    invalid_expression_dialogues: list[str] = []
    speaking_turn_by_character: dict[str, int] = {}
    for dialogue in expression_dialogues:
        character_id = dialogue["characterId"]
        speaking_turn = speaking_turn_by_character.get(character_id, 0)
        expected_expression_id = performance_expression_for_turn(
            character_id,
            DIALOGUE_EXPRESSION_CUES.get(dialogue["id"]),
            speaking_turn,
        )
        speaking_turn_by_character[character_id] = speaking_turn + 1
        if dialogue.get("expressionId") not in expression_ids.get(
            character_id, set()
        ) or expected_expression_id != dialogue.get("expressionId"):
            invalid_expression_dialogues.append(dialogue["id"])
    pose_variety_by_character = {
        character_id: sorted(
            {
                "primary"
                if expression_id.startswith(
                    (
                        "e",
                        "confident",
                        "maniac",
                        "annoyed",
                        "surprised",
                        "serious",
                        "concerned",
                        "closed",
                    )
                )
                else expression_id.rsplit("-e", 1)[0]
                for expression_id in (
                    dialogue.get("expressionId", "")
                    for dialogue in expression_dialogues
                    if dialogue["characterId"] == character_id
                )
                if expression_id
            }
        )
        for character_id in PERFORMANCE_POSE_CANDIDATES
    }
    missing_pose_variety = [
        character_id
        for character_id, pose_families in pose_variety_by_character.items()
        if len(pose_families) < 2
    ]
    cast_block_by_id = {block["id"]: block for block in cast_blocks}
    stage_managed_dialogue_ids = {
        dialogues[int(block_id.rsplit("-", 1)[1])]["id"]
        for block_id in cast_block_by_id
        if block_id.startswith("perf-cast-") and block_id != "perf-cast-final-clear"
    }
    direct_visible_dialogues = [
        dialogue
        for dialogue in visible_dialogues
        if dialogue["id"] not in stage_managed_dialogue_ids
    ]
    visible_hidden_portraits = [
        dialogue["id"]
        for dialogue in direct_visible_dialogues
        if not dialogue.get("portrait", {}).get("visible")
    ]
    stage_managed_visible_portraits = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue["id"] in stage_managed_dialogue_ids
        and dialogue.get("portrait", {}).get("visible")
    ]
    hidden_visible_portraits = [
        dialogue["id"]
        for dialogue in hidden_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    group_visible_portraits = [
        dialogue["id"]
        for dialogue in group_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    q_overlay_visible_portraits = [
        dialogue["id"]
        for dialogue in q_overlay_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    duplicate_portrait_layer_dialogues = []
    for cue_index, dialogue in enumerate(dialogues):
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if (
            block
            and dialogue.get("portrait", {}).get("visible")
            and any(
                member.get("characterId") == dialogue.get("characterId")
                for member in block.get("members", [])
            )
        ):
            duplicate_portrait_layer_dialogues.append(dialogue["id"])
    stale_cast_expressions: list[dict[str, Any]] = []
    last_expression_by_character: dict[str, str] = {}
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    for cue_index, dialogue in enumerate(dialogues):
        character_id = dialogue.get("characterId")
        if character_id in visible_character_ids and dialogue.get("expressionId"):
            last_expression_by_character[character_id] = dialogue["expressionId"]
        for character_name, expression_id in CAST_EXPRESSION_OVERRIDES.get(dialogue["id"], ()):
            override_character_id = find_character(document, (character_name,))["id"]
            last_expression_by_character[override_character_id] = performance_expression_id(
                override_character_id, expression_id
            )
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if not block:
            continue
        for member in block.get("members", []):
            expected = last_expression_by_character.get(
                member["characterId"]
            ) or character_by_id.get(member["characterId"], {}).get("defaultExpressionId")
            if member.get("expressionId") != expected:
                stale_cast_expressions.append(
                    {
                        "owner": block["id"],
                        "characterId": member["characterId"],
                        "expected": expected,
                        "actual": member.get("expressionId"),
                    }
                )

    unsafe_frames: list[dict[str, Any]] = []
    floating_frames: list[dict[str, Any]] = []

    def check_safe_frame(
        *,
        owner: str,
        character_id: str,
        expression_id: str | None,
        distance: str,
        transform: dict[str, Any],
    ) -> None:
        height = portrait_height_percent(document, character_id, expression_id)
        effective_height = (
            height * DISTANCE_SCALES.get(distance, 1.0) * float(transform.get("scale", 1))
        )
        top = float(transform.get("y", 100)) - effective_height
        if top < TOP_SAFE_PERCENT:
            unsafe_frames.append({"owner": owner, "topPercent": round(top, 3)})
        if (
            transform.get("anchor", "bottomCenter") == "bottomCenter"
            and float(transform.get("y", 100)) != STAGE_BOTTOM_PERCENT
        ):
            floating_frames.append(
                {"owner": owner, "bottomPercent": float(transform.get("y", 100))}
            )

    for block in cast_blocks:
        for member in block.get("members", []):
            check_safe_frame(
                owner=block["id"],
                character_id=member["characterId"],
                expression_id=member.get("expressionId"),
                distance=member["distance"],
                transform=member["transform"],
            )
    for dialogue in direct_visible_dialogues:
        portrait = dialogue["portrait"]
        inherited = next(
            (
                member
                for member in cast_at(dialogue["startMs"])
                if member.get("characterId") == dialogue["characterId"]
            ),
            {},
        )
        check_safe_frame(
            owner=dialogue["id"],
            character_id=dialogue["characterId"],
            expression_id=dialogue.get("expressionId"),
            distance=portrait.get("distance") or inherited.get("distance") or "medium",
            transform=portrait.get("transform") or inherited.get("transform") or {},
        )

    near_dialogue_ids = set()
    for cue_index, dialogue in enumerate(dialogues):
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if block and any(member.get("distance") == "near" for member in block.get("members", [])):
            near_dialogue_ids.add(dialogue["id"])
        elif dialogue.get("portrait", {}).get("distance") == "near":
            near_dialogue_ids.add(dialogue["id"])
    show_cg_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "showCg"
    ]
    hide_cg_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "hideCg"
    ]
    opening_declaration_blocks = [
        block for block in fragment.get("blocks", []) if block.get("id") == OPENING_DECLARATION_ID
    ]
    ending_thanks_blocks = [
        block for block in fragment.get("blocks", []) if block.get("id") == ENDING_THANKS_ID
    ]
    opening_event = next(
        (event for event in CG_EVENTS if event["key"] == "full-cast-opening"), None
    )
    first_dialogue_start_ms = min(dialogue["startMs"] for dialogue in dialogues)
    managed_cg_ids = {spec["cgId"] for spec in CG_ASSETS}
    cg_event_ids = [block["id"] for block in [*show_cg_blocks, *hide_cg_blocks]]
    cg_intervals = sorted(
        (event["startMs"], event["endMs"], event["key"])
        for event in CG_EVENTS
        if event["endMs"] is not None and not event["key"].startswith("q-")
    )
    cg_overlaps = [
        (left[2], right[2])
        for left, right in zip(cg_intervals, cg_intervals[1:], strict=False)
        if left[1] is not None and left[1] > right[0]
    ]
    scene_beats = [(block["atMs"], block["sceneId"]) for block in scene_blocks]
    expected_scene_beats = [
        (at_ms, scene_id_for_code(scene_code)) for at_ms, scene_code in SCENE_BEATS
    ]
    scene_events_inside_cgs = [
        {
            "sceneBlockId": block["id"],
            "atMs": block["atMs"],
            "cg": spec["key"],
        }
        for block in scene_blocks
        for spec in CG_EVENTS
        if spec["endMs"] is not None and spec["startMs"] < block["atMs"] < spec["endMs"]
    ]
    character_fades = [
        block["id"]
        for block in fragment.get("blocks", [])
        if block.get("type") == "setStageCast"
        and (
            (block.get("exitTransition") or {}).get("fade")
            or any(
                (member.get("transition") or {}).get("fade") for member in block.get("members", [])
            )
        )
    ] + [
        dialogue["id"]
        for dialogue in dialogues
        if (dialogue.get("portrait", {}).get("transition") or {}).get("fade")
    ]
    q_events = [event for event in CG_EVENTS if event["key"].startswith("q-")]
    group_cg_coverage = {
        dialogue["id"]: any(
            event["startMs"] <= dialogue["startMs"]
            and (event["endMs"] is None or event["endMs"] >= dialogue["endMs"])
            for event in CG_EVENTS
        )
        for dialogue in group_dialogues
    }
    final_cg_blocks = [
        block for block in show_cg_blocks if block["id"] == "runaway-cg-show-harem-chaos-finale"
    ]
    ending_blackboard_blocks = [
        block for block in show_cg_blocks if block["id"] == "runaway-cg-show-ending-blackboard"
    ]
    final_cg_hands_off_to_thanks = (
        len(final_cg_blocks) == 1
        and final_cg_blocks[0]["atMs"] == 1_763_485
        and len(ending_blackboard_blocks) == 1
        and ending_blackboard_blocks[0]["atMs"] == 1_773_594
        and not any(block["atMs"] >= 1_763_485 for block in hide_cg_blocks)
    )
    fullscreen_events = [event for event in CG_EVENTS if event["displayMode"] == "fullscreen"]
    dialogue_start_ms = {dialogue["startMs"] for dialogue in dialogues}
    fullscreen_timing_errors = [
        event["key"]
        for event in fullscreen_events
        if event["startMs"] != 0
        and event["startMs"] not in dialogue_start_ms
        and not any(
            previous.get("endMs") is not None and event["startMs"] == previous["endMs"] + 1
            for previous in fullscreen_events
        )
    ]
    cg_entry_stage_flash_risks = [
        block["id"]
        for block in cast_blocks
        if any(
            event["startMs"] > 0 and block.get("atMs") == event["startMs"]
            for event in fullscreen_events
        )
    ]
    cg_entry_portrait_flash_risks = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("portrait", {}).get("visible")
        and any(
            event["startMs"] > 0 and dialogue["startMs"] == event["startMs"]
            for event in fullscreen_events
        )
    ]
    fullscreen_visible_portraits = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("portrait", {}).get("visible")
        and fullscreen_cg_at(dialogue["startMs"]) is not None
    ]
    suzuha = find_character(document, ("铃羽", "鈴羽", "玲羽", "Suzuha"))
    suzuha_asset_ids = {
        expression.get("assetId", "") for expression in suzuha.get("expressions", [])
    }
    suzuha_crop_dimensions = {
        png_dimensions(suzuha_crop_entry(pose, variant, mouth)[0])
        for pose, variant in SUZUHA_VARIANTS.values()
        for mouth in range(3)
    }
    curated_character_checks: dict[str, dict[str, Any]] = {}
    for character_spec in CURATED_CHARACTER_POSES:
        character = find_character(document, character_spec["characterNames"])
        expressions = {
            expression["id"]: expression for expression in character.get("expressions", [])
        }
        expected_ids: set[str] = set()
        expected_asset_prefixes: dict[str, str] = {}
        replace_primary = bool(character_spec.get("replacePrimary"))
        primary_pose = character_spec["poses"][0]["code"]
        for pose_spec in character_spec["poses"]:
            pose = pose_spec["code"]
            asset_prefix = f"sg0-{pose.lower().replace('_', '-')}-"
            for variant in range(1, len(pose_spec["labels"]) + 1):
                expression_id = (
                    f"e{variant:03d}-f000"
                    if replace_primary and pose == primary_pose
                    else curated_expression_id(pose, variant)
                )
                expected_ids.add(expression_id)
                expected_asset_prefixes[expression_id] = asset_prefix
        missing_ids = sorted(expected_ids - expressions.keys())
        wrong_assets: list[str] = []
        invalid_sequences: list[str] = []
        for expression_id, expected_prefix in expected_asset_prefixes.items():
            expression = expressions.get(expression_id)
            if not expression:
                continue
            if not str(expression.get("assetId", "")).startswith(expected_prefix):
                wrong_assets.append(expression_id)
            sequence = expression.get("sequence") or {}
            frames = sequence.get("frames") or []
            if (
                sequence.get("playbackMode") != "lipSync"
                or sequence.get("fps") != LIP_SYNC_FPS
                or len(frames) != 3
                or any(
                    not str(frame.get("assetId", "")).startswith(expected_prefix)
                    for frame in frames
                )
            ):
                invalid_sequences.append(expression_id)
        curated_character_checks[character["id"]] = {
            "expectedCount": len(expected_ids),
            "installedCount": len(expected_ids & expressions.keys()),
            "missingExpressionIds": missing_ids,
            "wrongAssets": wrong_assets,
            "invalidSequences": invalid_sequences,
        }
    crowded_cast_layout_errors = [
        block["id"]
        for block in cast_blocks
        if len(block.get("members", [])) in {2, 3}
        and min(
            right - left
            for left, right in zip(
                sorted(member["transform"]["x"] for member in block["members"]),
                sorted(member["transform"]["x"] for member in block["members"])[1:],
                strict=False,
            )
        )
        < (56 if len(block.get("members", [])) == 2 else 35)
    ]
    logical_library = logical_library_entries(source_root, original_source_root)
    missing_mapping = [
        item["relative"]
        for item in logical_library
        if item["relative"] not in mapping.get("items", {})
    ]
    missing_cg_mapping = [
        spec["relative"] for spec in CG_ASSETS if spec["relative"] not in mapping.get("items", {})
    ]
    kagari = find_character(document, ("冈部篝", "幼年篝"))

    def display_name_value(dialogue: dict[str, Any]) -> str:
        character = character_by_id[dialogue["characterId"]]
        selected = dialogue.get("displayNameId") or character.get("defaultDisplayNameId")
        display = next(
            (item for item in character.get("displayNames", []) if item.get("id") == selected),
            None,
        )
        return str((display or {}).get("value") or character.get("name") or "")

    dialogue_by_id = {dialogue["id"]: dialogue for dialogue in dialogues}
    ensemble_character_id = find_character(document, ("众人",))["id"]
    multi_name_errors = [
        dialogue["id"]
        for dialogue in dialogues
        if (
            display_name_value(dialogue) == "众人"
            and (
                dialogue.get("characterId") != ensemble_character_id
                or dialogue.get("speakerIds") != [ensemble_character_id]
            )
        )
        or (
            dialogue.get("characterId") == ensemble_character_id
            and dialogue.get("speakerIds") != [ensemble_character_id]
        )
    ]
    kagari_unknown_name_errors = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("characterId") == kagari["id"]
        and int(dialogue["id"].rsplit("-", 1)[1]) <= 116
        and display_name_value(dialogue) != "红发小女孩"
    ]
    kagari_known_name_errors = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue.get("characterId") == kagari["id"]
        and int(dialogue["id"].rsplit("-", 1)[1]) >= 118
        and display_name_value(dialogue) != "冈部篝"
    ]
    checks = {
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueCount": len(dialogues),
        "allLipSyncFps5": bool(lip_sync_fps) and set(lip_sync_fps) == {LIP_SYNC_FPS},
        "dialogueBoxSemiTransparent": (
            document.get("presentation", {}).get("dialogueBox", {}).get("backgroundColor")
            == "#05070B"
            and document.get("presentation", {}).get("dialogueBox", {}).get("backgroundOpacity")
            == DIALOGUE_BOX_OPACITY
            and document.get("presentation", {})
            .get("dialogueBox", {})
            .get("background", {})
            .get("gradientTopOpacity")
            == 1
            and document.get("presentation", {})
            .get("dialogueBox", {})
            .get("background", {})
            .get("gradientBottomOpacity")
            == 1
        ),
        "dialogueBodyFontSizePx": document.get("presentation", {})
        .get("dialogueBox", {})
        .get("body", {})
        .get("fontSizePx"),
        "dialogueBodyMaxWidthPercent": document.get("presentation", {})
        .get("dialogueBox", {})
        .get("body", {})
        .get("maxWidthPercent"),
        "explicitExpressionCueCount": len(DIALOGUE_EXPRESSION_CUES),
        "visibleDialogueCount": len(visible_dialogues),
        "hiddenDialogueCount": len(hidden_dialogues),
        "groupCgDialogueCount": len(group_dialogues),
        "qOverlayDialogueCount": len(q_overlay_dialogues),
        "groupCgCoverage": group_cg_coverage,
        "invalidExpressionDialogues": invalid_expression_dialogues,
        "poseVarietyByCharacter": pose_variety_by_character,
        "missingPoseVariety": missing_pose_variety,
        "expressionLabelMismatches": expression_label_mismatches,
        "ambiguousExpressionLabels": ambiguous_expression_labels,
        "visibleHiddenPortraits": visible_hidden_portraits,
        "stageManagedVisiblePortraits": stage_managed_visible_portraits,
        "duplicatePortraitLayerDialogues": duplicate_portrait_layer_dialogues,
        "hiddenVisiblePortraits": hidden_visible_portraits,
        "groupVisiblePortraits": group_visible_portraits,
        "qOverlayVisiblePortraits": q_overlay_visible_portraits,
        "staleCastExpressions": stale_cast_expressions,
        "nearDialogueCount": len(near_dialogue_ids),
        "nearDialogueIdsMatchCurated": near_dialogue_ids == SAFE_CLOSEUP_DIALOGUE_IDS,
        "unsafeCharacterFrames": unsafe_frames,
        "floatingCharacterFrames": floating_frames,
        "maxCastSize": max((len(block.get("members", [])) for block in cast_blocks), default=0),
        "crowdedCastLayoutErrors": crowded_cast_layout_errors,
        "firstPersonNeverVisible": all(
            first_person_id not in {member["characterId"] for member in block.get("members", [])}
            for block in cast_blocks
        ),
        "sceneBeatCount": len(scene_blocks),
        "sceneBeatsExact": scene_beats == expected_scene_beats,
        "sceneTransitionsReady": all(
            (block["transition"]["durationMs"], block["transition"]["fade"])
            == (
                (0, False)
                if block["atMs"] == 0
                or block["atMs"] in HIDDEN_SCENE_SWITCH_MS
                or block["atMs"] in CG_EVENT_STARTS
                else (450, True)
                if block["atMs"] == 387_752
                else (350, True)
            )
            for block in scene_blocks
        ),
        "sceneEventsInsideCgs": scene_events_inside_cgs,
        "distinctSceneCount": len({block["sceneId"] for block in scene_blocks}),
        "cameraBeatCount": len(camera_blocks),
        "cameraUiIsolationReady": all(
            block.get("target")
            == ("cg" if block.get("id", "").startswith("runaway-phone-camera-") else "background")
            for block in camera_blocks
        ),
        "silentGapCount": len(silent_gaps),
        "nonemptySilentGaps": nonempty_silent_gaps,
        "curtainCount": len(curtain_blocks),
        "curtainEventsExact": sorted(
            (
                block["id"],
                block["atMs"],
                block["action"],
                block["durationMs"],
            )
            for block in curtain_blocks
        )
        == sorted(
            (
                block["id"],
                block["atMs"],
                block["action"],
                block["durationMs"],
            )
            for block in TRANSITION_CARD_BLOCKS
            if block["type"] == "curtain"
        ),
        "transitionTextsExact": sorted(
            (block.get("atMs"), block.get("text"), block.get("durationMs"))
            for block in fragment.get("blocks", [])
            if block.get("id", "").startswith("runaway-transition-")
        )
        == [
            (368_743, "众人前往屋顶......", 3_700),
            (451_633, "众人回到lab......", 4_800),
            (683_114, "玲羽和众人解释一番过后......", 3_358),
        ],
        "characterFadeBlocks": character_fades,
        "showCgCount": len(show_cg_blocks),
        "hideCgCount": len(hide_cg_blocks),
        "managedCgDefinitionsReady": managed_cg_ids <= {cg["id"] for cg in document.get("cgs", [])},
        "duplicateCgEventIds": len(cg_event_ids) != len(set(cg_event_ids)),
        "cgOverlaps": cg_overlaps,
        "qOverlayReady": len(q_events) == 3
        and all(
            event["displayMode"] == "overlay"
            and event["overlay"]["x"] == 50
            and event["overlay"]["y"] == 50
            and abs((event["overlay"]["width"] / 100) ** 2 - 1 / 6) <= 0.01
            for event in q_events
        ),
        "openingDeclarationReady": len(opening_declaration_blocks) == 1
        and opening_declaration_blocks[0].get("atMs") == 500
        and opening_declaration_blocks[0].get("durationMs") == 10_000
        and opening_declaration_blocks[0].get("text") == OPENING_DECLARATION_TEXT
        and opening_declaration_blocks[0].get("x") == 50
        and opening_declaration_blocks[0].get("y") == 50
        and opening_declaration_blocks[0].get("color") == "#F4E7C5",
        "openingCgBeforeVoice": bool(opening_event)
        and opening_event["startMs"] == 0
        and opening_event["endMs"] == 11_500
        and opening_event["endMs"] < first_dialogue_start_ms,
        "finalCgHandsOffToThanks": final_cg_hands_off_to_thanks,
        "endingThanksReady": len(ending_thanks_blocks) == 1
        and ending_thanks_blocks[0].get("atMs") == 1_774_194
        and ending_thanks_blocks[0].get("durationMs") == 6_150
        and ending_thanks_blocks[0].get("text") == ENDING_THANKS_TEXT
        and ending_thanks_blocks[0].get("x") == 50
        and ending_thanks_blocks[0].get("y") == 50
        and ending_thanks_blocks[0].get("color") == "#F4E7C5"
        and dialogues[-1].get("hideDialogueAfter") is True,
        "fullscreenCgTimingErrors": fullscreen_timing_errors,
        "cgEntryStageFlashRisks": cg_entry_stage_flash_risks,
        "cgEntryPortraitFlashRisks": cg_entry_portrait_flash_risks,
        "fullscreenCgVisiblePortraits": fullscreen_visible_portraits,
        "suzuhaUsesSg0BlueVest": bool(suzuha_asset_ids)
        and all(
            asset_id.startswith(("sg0-suz-half-v1-suz-hs", "sg0-suz-hm"))
            for asset_id in suzuha_asset_ids
        )
        and any("hsd" in asset_id for asset_id in suzuha_asset_ids)
        and any("hse" in asset_id for asset_id in suzuha_asset_ids)
        and any("hmd" in asset_id for asset_id in suzuha_asset_ids)
        and any("hme" in asset_id for asset_id in suzuha_asset_ids),
        "suzuhaCropFrameDimensions": sorted(suzuha_crop_dimensions),
        "curatedCharacterExpressions": curated_character_checks,
        "farisUsesRuffledCasualOutfit": all(
            next(
                expression
                for expression in find_character(document, ("菲莉丝",))["expressions"]
                if expression["id"] == f"e{variant:03d}-f000"
            )["assetId"].startswith("sg0-fei-dla-")
            for variant in range(1, 5)
        ),
        "lukaUsesBlackCasualOutfit": all(
            next(
                expression
                for expression in find_character(document, ("漆原琉华",))["expressions"]
                if expression["id"] == f"e{variant:03d}-f000"
            )["assetId"].startswith("sg0-ruk-cla-")
            for variant in range(1, 7)
        ),
        "kagariCharacterName": kagari["name"],
        "kagariUnknownNameErrors": kagari_unknown_name_errors,
        "kagariKnownNameErrors": kagari_known_name_errors,
        "multiNameErrors": multi_name_errors,
        "pairNamesExact": display_name_value(dialogue_by_id["runaway-annotated-line-0377"])
        == "冈部伦太郎、桥田至"
        and display_name_value(dialogue_by_id["runaway-annotated-line-0463"])
        == "阿万音铃羽、比屋定真帆",
        "rejectedSceneReferences": [
            block["sceneId"] for block in scene_blocks if block["sceneId"] == "sg0-bg03a3"
        ],
        "logicalLibraryCount": len(logical_library),
        "missingLogicalMappings": missing_mapping,
        "missingCgMappings": missing_cg_mapping,
        "blockCount": len(fragment.get("blocks", [])),
        "annotation": annotation_audit,
    }
    if checks["durationMs"] != 1_780_344 or checks["dialogueCount"] != 514:
        raise RuntimeError(f"对白或时间轴审计失败：{checks}")
    if not checks["allLipSyncFps5"]:
        raise RuntimeError("仍有唇形序列不是 5 FPS")
    if not checks["dialogueBoxSemiTransparent"]:
        raise RuntimeError("对白框没有保持最高层半透明样式")
    if checks["dialogueBodyFontSizePx"] != 34 or checks["dialogueBodyMaxWidthPercent"] != 100:
        raise RuntimeError("对白正文字号或可用宽度未按 V8 应用")
    if (
        checks["explicitExpressionCueCount"] != 410
        or invalid_expression_dialogues
        or missing_pose_variety
        or expression_label_mismatches
        or ambiguous_expression_labels
        or visible_hidden_portraits
        or stage_managed_visible_portraits
        or duplicate_portrait_layer_dialogues
        or hidden_visible_portraits
        or group_visible_portraits
        or q_overlay_visible_portraits
        or stale_cast_expressions
        or fullscreen_visible_portraits
        or checks["visibleDialogueCount"]
        + checks["hiddenDialogueCount"]
        + checks["groupCgDialogueCount"]
        + checks["qOverlayDialogueCount"]
        != 514
    ):
        raise RuntimeError(
            "逐句表情或隐藏人物审计失败："
            + json.dumps(
                {
                    "explicitExpressionCueCount": checks["explicitExpressionCueCount"],
                    "invalidExpressionDialogues": invalid_expression_dialogues,
                    "poseVarietyByCharacter": pose_variety_by_character,
                    "missingPoseVariety": missing_pose_variety,
                    "expressionLabelMismatches": expression_label_mismatches,
                    "ambiguousExpressionLabels": ambiguous_expression_labels,
                    "visibleHiddenPortraits": visible_hidden_portraits,
                    "stageManagedVisiblePortraits": stage_managed_visible_portraits,
                    "duplicatePortraitLayerDialogues": duplicate_portrait_layer_dialogues,
                    "hiddenVisiblePortraits": hidden_visible_portraits,
                    "groupVisiblePortraits": group_visible_portraits,
                    "qOverlayVisiblePortraits": q_overlay_visible_portraits,
                    "staleCastExpressions": stale_cast_expressions,
                    "fullscreenVisiblePortraits": fullscreen_visible_portraits,
                },
                ensure_ascii=False,
            )
        )
    if (
        not checks["nearDialogueIdsMatchCurated"]
        or checks["nearDialogueCount"] != 16
        or unsafe_frames
        or floating_frames
    ):
        raise RuntimeError("安全近景或顶部安全区审计失败")
    if (
        checks["maxCastSize"] > 3
        or checks["crowdedCastLayoutErrors"]
        or not checks["firstPersonNeverVisible"]
    ):
        raise RuntimeError(
            "舞台人数或第一人称冈部审计失败："
            f"maxCastSize={checks['maxCastSize']}, "
            f"crowdedCastLayoutErrors={checks['crowdedCastLayoutErrors']}, "
            f"firstPersonNeverVisible={checks['firstPersonNeverVisible']}"
        )
    if (
        checks["sceneBeatCount"] != len(SCENE_BEATS)
        or not checks["sceneBeatsExact"]
        or not checks["sceneTransitionsReady"]
        or checks["sceneEventsInsideCgs"]
        or checks["distinctSceneCount"] < 7
        or checks["rejectedSceneReferences"]
    ):
        raise RuntimeError("场景丰富度没有达到验收条件")
    if (
        checks["cameraBeatCount"] < 12
        or not checks["cameraUiIsolationReady"]
        or not checks["suzuhaUsesSg0BlueVest"]
        or checks["suzuhaCropFrameDimensions"] != [(482, 960)]
    ):
        raise RuntimeError(
            "镜头、静默区间、第一人称反应或铃羽素材审计失败："
            + json.dumps(
                {
                    key: checks[key]
                    for key in (
                        "cameraBeatCount",
                        "cameraUiIsolationReady",
                        "suzuhaUsesSg0BlueVest",
                    )
                },
                ensure_ascii=False,
            )
        )
    if (
        not checks["farisUsesRuffledCasualOutfit"]
        or not checks["lukaUsesBlackCasualOutfit"]
        or any(
            item["missingExpressionIds"]
            or item["wrongAssets"]
            or item["invalidSequences"]
            or item["installedCount"] != item["expectedCount"]
            for item in checks["curatedCharacterExpressions"].values()
        )
    ):
        raise RuntimeError(
            "精选私服或扩充表情素材审计失败："
            + json.dumps(
                {
                    "farisUsesRuffledCasualOutfit": checks["farisUsesRuffledCasualOutfit"],
                    "lukaUsesBlackCasualOutfit": checks["lukaUsesBlackCasualOutfit"],
                    "curatedCharacterExpressions": checks["curatedCharacterExpressions"],
                },
                ensure_ascii=False,
            )
        )
    if (
        checks["showCgCount"] != len(CG_EVENTS)
        or checks["hideCgCount"] != sum(event["endMs"] is not None for event in CG_EVENTS)
        or not checks["managedCgDefinitionsReady"]
        or checks["duplicateCgEventIds"]
        or cg_overlaps
        or not checks["qOverlayReady"]
        or not checks["openingDeclarationReady"]
        or not checks["openingCgBeforeVoice"]
        or not checks["finalCgHandsOffToThanks"]
        or not checks["endingThanksReady"]
        or checks["fullscreenCgTimingErrors"]
        or checks["cgEntryStageFlashRisks"]
        or checks["cgEntryPortraitFlashRisks"]
        or not all(checks["groupCgCoverage"].values())
        or checks["blockCount"] > 1000
    ):
        raise RuntimeError(
            "CG 事件或 Block 上限审计失败："
            + json.dumps(
                {
                    key: checks[key]
                    for key in (
                        "showCgCount",
                        "hideCgCount",
                        "duplicateCgEventIds",
                        "cgOverlaps",
                        "qOverlayReady",
                        "openingDeclarationReady",
                        "openingCgBeforeVoice",
                        "finalCgHandsOffToThanks",
                        "endingThanksReady",
                        "fullscreenCgTimingErrors",
                        "cgEntryStageFlashRisks",
                        "cgEntryPortraitFlashRisks",
                        "blockCount",
                    )
                },
                ensure_ascii=False,
            )
        )
    if checks["logicalLibraryCount"] != 701 or missing_mapping or missing_cg_mapping:
        raise RuntimeError("原作素材映射不完整")
    if (
        checks["curtainCount"]
        != sum(block["type"] == "curtain" for block in TRANSITION_CARD_BLOCKS)
        or not checks["curtainEventsExact"]
        or not checks["transitionTextsExact"]
        or checks["characterFadeBlocks"]
    ):
        raise RuntimeError("场景幕布、过场文字或人物淡化审计失败")
    if (
        checks["kagariCharacterName"] != "冈部篝"
        or checks["kagariUnknownNameErrors"]
        or checks["kagariKnownNameErrors"]
        or checks["multiNameErrors"]
        or not checks["pairNamesExact"]
    ):
        raise RuntimeError("对白显示名称审计失败")
    if annotation_audit is not None:
        if (
            annotation_audit["sha256"] != EXPECTED_ANNOTATION_SHA256
            or annotation_audit["rawMultiSpeakerCount"] != EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES
            or annotation_audit["multiSpeakerCount"] != EXPECTED_STORY_MULTI_SPEAKER_LINES
            or annotation_audit["crowdNormalizedCount"] != EXPECTED_CROWD_NORMALIZED_LINES
            or annotation_audit["storyMultiSpeakerCount"] != EXPECTED_STORY_MULTI_SPEAKER_LINES
            or dialogue_signature(fragment) != annotation_audit["expectedDialogueSignature"]
        ):
            raise RuntimeError("新版对白标注审计失败")
    return checks


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


def apply_story(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        backup_path = BACKUP_ROOT / f"{timestamp()}-performance-before.json"
        write_json(backup_path, latest)
        document, audit = transform_latest_story(
            latest,
            mapping,
            source_root,
            original_source_root,
            annotation_path,
        )
        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                print("故事 revision 已变化，重新读取并重算演出", flush=True)
                continue
            raise
        audit_path = BACKUP_ROOT / f"{timestamp()}-performance-apply-audit.json"
        write_json(
            audit_path,
            {
                **audit,
                "beforeSnapshot": str(backup_path),
                "savedRevision": saved["revision"],
            },
        )
        print(
            json.dumps(
                {
                    "savedRevision": saved["revision"],
                    "audit": str(audit_path),
                },
                ensure_ascii=False,
            )
        )
        return saved
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def inspect(client: httpx.Client, project_id: str) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    fragment = target_fragment(story["document"])
    summary = {
        "revision": story["revision"],
        "durationMs": fragment.get("timeline", {}).get("durationMs"),
        "dialogueCount": len(dialogue_signature(fragment)),
        "characters": [
            {
                "id": character["id"],
                "name": character["name"],
                "expressions": len(character.get("expressions", [])),
            }
            for character in story["document"].get("characters", [])
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def rename_live_expression_labels(
    client: httpx.Client,
    project_id: str,
    *,
    character_ids: set[str] | None = None,
    backup_name: str = "expression-labels",
) -> dict[str, Any]:
    checked_ids = character_ids or set(AUDITED_EXPRESSION_LABELS)
    checked_expressions = sum(
        len(AUDITED_EXPRESSION_LABELS[character_id]) for character_id in checked_ids
    )
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        document = deepcopy(latest["document"])
        changes = rename_audited_expression_labels(document, character_ids)
        if not changes:
            result = {
                "revision": latest["revision"],
                "checkedCharacters": len(checked_ids),
                "checkedExpressions": checked_expressions,
                "changed": 0,
                "changes": [],
            }
            print(json.dumps(result, ensure_ascii=False))
            return result
        backup_path = BACKUP_ROOT / f"{timestamp()}-{backup_name}-before.json"
        write_json(backup_path, latest)
        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                continue
            raise
        result = {
            "revision": saved["revision"],
            "checkedCharacters": len(checked_ids),
            "checkedExpressions": checked_expressions,
            "changed": len(changes),
            "changes": changes,
            "beforeSnapshot": str(backup_path),
        }
        print(json.dumps(result, ensure_ascii=False))
        return result
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def rename_live_kurisu_expressions(client: httpx.Client, project_id: str) -> dict[str, Any]:
    return rename_live_expression_labels(
        client,
        project_id,
        character_ids={"kurisu-makise"},
        backup_name="kurisu-labels",
    )


def audit_live(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    original_source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    listed = request_json(client, "GET", project_path(project_id, "/assets"))["items"]
    existing_ids = {asset["id"] for asset in listed}
    missing_assets = [
        relative
        for relative, item in mapping.get("items", {}).items()
        if item["assetId"] not in existing_ids
    ]
    document = deepcopy(story["document"])
    annotation_audit = apply_annotation(document, annotation_path)
    if dialogue_signature(target_fragment(document)) != dialogue_signature(
        target_fragment(story["document"])
    ):
        raise RuntimeError("线上故事尚未与新版对白标注完全一致")
    checks = audit_document(
        story["document"],
        mapping,
        source_root,
        original_source_root,
        annotation_audit,
    )
    checks["missingProjectAssets"] = missing_assets
    if missing_assets:
        raise RuntimeError("映射中的项目素材记录不存在")
    audit_path = BACKUP_ROOT / f"{timestamp()}-performance-final-audit.json"
    write_json(audit_path, {"revision": story["revision"], "checks": checks})
    print(json.dumps({"audit": str(audit_path), **checks}, ensure_ascii=False))
    return checks


def main() -> None:
    args = parse_args()
    management_key = management_api_key()
    if not args.source_root.is_dir():
        raise RuntimeError(f"SG0 素材目录不存在：{args.source_root}")
    if not args.original_source_root.is_dir():
        raise RuntimeError(f"原作素材目录不存在：{args.original_source_root}")
    if not args.annotation.is_file():
        raise RuntimeError(f"新版对白标注不存在：{args.annotation}")
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        if args.action == "inspect":
            inspect(client, args.project_id)
            return
        if args.action == "rename-kurisu":
            rename_live_kurisu_expressions(client, args.project_id)
            return
        if args.action == "rename-expressions":
            rename_live_expression_labels(client, args.project_id)
            return
        mapping = load_asset_map(args.project_id, args.source_root)
        if args.action in {"upload", "all"}:
            mapping = upload_assets(
                client,
                args.project_id,
                args.source_root,
                args.original_source_root,
                args.batch_size,
            )
        if args.action in {"apply", "all"}:
            apply_story(
                client,
                args.project_id,
                mapping,
                args.source_root,
                args.original_source_root,
                args.annotation,
            )
        if args.action in {"audit", "all"}:
            audit_live(
                client,
                args.project_id,
                mapping,
                args.source_root,
                args.original_source_root,
                args.annotation,
            )


if __name__ == "__main__":
    main()
