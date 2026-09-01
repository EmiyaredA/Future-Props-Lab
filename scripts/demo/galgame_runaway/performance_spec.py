# ruff: noqa: F401

from __future__ import annotations

import json
from copy import deepcopy
from math import floor
from pathlib import Path
from typing import Any

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
EXPECTED_ANNOTATION_SHA256 = "4741e55f63d75ea6150e52c08dc691de01b9a473e983601141815acaf47c8bc8"
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
