from __future__ import annotations

from pathlib import Path
from typing import Any

TOP_SAFE_PERCENT = 6.0
DISTANCE_SCALES = {"far": 0.78, "medium": 1.0, "near": 1.28}

# 精选情绪近景。所有时间点都避开 CG，且只允许单人构图使用。
SAFE_CLOSEUP_DIALOGUE_IDS = frozenset(
    {
        "runaway-annotated-line-0176",
        "runaway-annotated-line-0177",
        "runaway-annotated-line-0184",
        "runaway-annotated-line-0186",
        "runaway-annotated-line-0197",
        "runaway-annotated-line-0233",
        "runaway-annotated-line-0240",
        "runaway-annotated-line-0252",
        "runaway-annotated-line-0270",
        "runaway-annotated-line-0328",
        "runaway-annotated-line-0359",
        "runaway-annotated-line-0394",
        "runaway-annotated-line-0400",
        "runaway-annotated-line-0438",
        "runaway-annotated-line-0468",
        "runaway-annotated-line-0494",
    }
)


def _cg(
    key: str,
    filename: str,
    name: str,
    description: str,
    start_ms: int,
    end_ms: int | None,
    *,
    cg_id: str | None = None,
    variant_id: str | None = None,
    story_asset_id: str | None = None,
    transition_ms: int = 450,
) -> dict[str, Any]:
    return {
        "key": key,
        "path": Path(filename),
        "relative": f"project-cgs/{Path(filename).name}",
        "name": name,
        "description": description,
        "startMs": start_ms,
        "endMs": end_ms,
        "cgId": cg_id or f"cg-runaway-{key}",
        "variantId": variant_id or f"cg-runaway-{key}-default",
        "storyAssetId": story_asset_id or f"cg-runaway-{key}-asset",
        "transitionMs": transition_ms,
    }


CG_SPECS = (
    _cg(
        "q-prep",
        "docs/assets/galgame-ui/okabe-laugh-prep-cg.png",
        "冈部伦太郎·狂笑前酝酿",
        "冈部闭眼露出得意表情，蓄势准备狂笑。",
        12_000,
        None,
        cg_id="0509d828-47ae-4722-a4ab-45822328b533",
        variant_id="a960f9db-7186-4c12-9230-a3df4e4dcbb5",
        story_asset_id="fc726073-b1cc-4bc7-9339-f1f514727825",
        transition_ms=220,
    ),
    _cg(
        "q-laugh",
        "docs/assets/galgame-ui/okabe-maniacal-laughter-cg.png",
        "冈部伦太郎·狂笑",
        "冈部在实验室的冷暖光影中放声狂笑。",
        15_592,
        None,
        cg_id="68221a84-091d-4e4c-83b5-b25e6e46231d",
        variant_id="cc82041c-9f54-47b8-96b6-8069ca499cbd",
        story_asset_id="292a3046-d323-435e-bcfa-d861247403dc",
        transition_ms=220,
    ),
    _cg(
        "q-cough",
        "docs/assets/galgame-ui/okabe-laugh-cough-cg.png",
        "冈部伦太郎·狂笑后咳嗽",
        "冈部狂笑过度后前倾呛咳。",
        22_571,
        27_843,
        cg_id="3a2a71b4-016c-4672-97af-911d0458cfcc",
        variant_id="4f7201ff-d012-4729-82af-20cb2ed82496",
        story_asset_id="8c625225-1c67-41da-84ab-43adf5141a7f",
        transition_ms=220,
    ),
    _cg(
        "kagari-arrival",
        "docs/assets/galgame-runaway-cgs/01-kagari-arrival.png",
        "来自 2036 年的女孩",
        "开启的时间机器前，幼年篝走出舱门，众人惊讶回望。",
        388_383,
        396_383,
    ),
    _cg(
        "kagari-hugs-okabe",
        "docs/assets/galgame-runaway-cgs/11-kagari-hugs-okabe.png",
        "爸爸！",
        "幼年篝冲上前紧紧抱住白大褂冈部，冈部惊讶地低头看她。",
        416_108,
        423_872,
    ),
    _cg(
        "kagari-hououin-imitation",
        "docs/assets/galgame-runaway-cgs/07-kagari-hououin-imitation.png",
        "篝的凤凰院凶真模仿秀",
        "篝模仿凤凰院凶真的夸张姿势，实验室众人忍俊不禁。",
        593_385,
        600_885,
    ),
    _cg(
        "mother-identity-stop",
        "docs/assets/galgame-runaway-cgs/08-mother-identity-stop.png",
        "禁止追问未来",
        "众人围着篝追问母亲身份，铃羽突然严厉制止。",
        780_228,
        787_728,
    ),
    _cg(
        "father-daughter-storytime",
        "docs/assets/galgame-runaway-cgs/02-father-daughter-storytime.png",
        "临时爸爸",
        "实验室暖光中，篝依偎在冈部身边听他读故事。",
        1_096_781,
        1_104_781,
    ),
    _cg(
        "cleaning-sergeant",
        "docs/assets/galgame-runaway-cgs/09-cleaning-sergeant.png",
        "扫除曹长驾到",
        "天王寺裕吾闯入实验室，侧身指向冈部与桶子严厉训话。",
        1_233_804,
        1_241_304,
    ),
    _cg(
        "suzuha-end-it",
        "docs/assets/galgame-runaway-cgs/06-suzuha-end-it.png",
        "果然还是结束这一切吧",
        "铃羽含泪直视前方，做出痛苦而决绝的决定。",
        1_389_315,
        1_392_725,
    ),
    _cg(
        "kagari-rejects-mother",
        "docs/assets/galgame-runaway-cgs/03-kagari-rejects-mother.png",
        "妈妈不喜欢我",
        "篝含泪倔强地说出伤人的话，铃羽严肃地面对她。",
        1_442_273,
        1_449_773,
    ),
    _cg(
        "kagari-remembers-mother",
        "docs/assets/galgame-runaway-cgs/04-kagari-remembers-mother.png",
        "想起妈妈",
        "篝哭着道歉，真由理与红莉栖在实验室里安慰她。",
        1_562_135,
        1_570_135,
    ),
    _cg(
        "rooftop-farewell",
        "docs/assets/galgame-runaway-cgs/05-rooftop-farewell.png",
        "屋顶告别",
        "篝在时间机器舱门前回头挥手，铃羽等待登舱。",
        1_655_044,
        1_663_044,
    ),
    _cg(
        "harem-chaos-finale",
        "docs/assets/galgame-runaway-cgs/10-harem-chaos-finale.png",
        "大家都是妈妈？",
        "众人误解成全员都是篝的妈妈，冈部被围在结尾的混乱中心。",
        1_735_012,
        1_743_012,
    ),
)
