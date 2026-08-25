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


def _asset(
    key: str,
    filename: str,
    name: str,
    description: str,
    *,
    cg_id: str | None = None,
    variant_id: str | None = None,
    story_asset_id: str | None = None,
    relative: str | None = None,
) -> dict[str, Any]:
    path = Path(filename)
    return {
        "key": key,
        "path": path,
        "relative": relative or f"project-cgs/{path.name}",
        "name": name,
        "description": description,
        "cgId": cg_id or f"cg-runaway-{key}",
        "variantId": variant_id or f"cg-runaway-{key}-default",
        "storyAssetId": story_asset_id or f"cg-runaway-{key}-asset",
    }


CG_ASSETS = (
    _asset(
        "q-prep",
        "docs/assets/galgame-ui/okabe-laugh-prep-cg.png",
        "冈部伦太郎·狂笑前酝酿",
        "冈部闭眼露出得意表情，蓄势准备狂笑。",
        cg_id="0509d828-47ae-4722-a4ab-45822328b533",
        variant_id="a960f9db-7186-4c12-9230-a3df4e4dcbb5",
        story_asset_id="fc726073-b1cc-4bc7-9339-f1f514727825",
    ),
    _asset(
        "q-laugh",
        "docs/assets/galgame-ui/okabe-maniacal-laughter-cg.png",
        "冈部伦太郎·狂笑",
        "冈部在实验室的冷暖光影中放声狂笑。",
        cg_id="68221a84-091d-4e4c-83b5-b25e6e46231d",
        variant_id="cc82041c-9f54-47b8-96b6-8069ca499cbd",
        story_asset_id="292a3046-d323-435e-bcfa-d861247403dc",
    ),
    _asset(
        "q-cough",
        "docs/assets/galgame-ui/okabe-laugh-cough-cg.png",
        "冈部伦太郎·狂笑后咳嗽",
        "冈部狂笑过度后前倾呛咳。",
        cg_id="3a2a71b4-016c-4672-97af-911d0458cfcc",
        variant_id="4f7201ff-d012-4729-82af-20cb2ed82496",
        story_asset_id="8c625225-1c67-41da-84ab-43adf5141a7f",
    ),
    _asset(
        "roundtable-maho-v2",
        "docs/assets/galgame-runaway-cgs/12-roundtable-with-maho-v2.png",
        "加入真帆的圆桌会议",
        "原作实验室圆桌会议构图中加入当前形象的比屋定真帆。",
    ),
    _asset(
        "kagari-arrival",
        "docs/assets/galgame-runaway-cgs/01-kagari-arrival.png",
        "来自 2036 年的女孩",
        "开启的时间机器前，红发小女孩走出舱门，众人惊讶回望。",
    ),
    _asset(
        "kagari-hugs-okabe",
        "docs/assets/galgame-runaway-cgs/11-kagari-hugs-okabe.png",
        "爸爸！",
        "冈部篝冲上前紧紧抱住白大褂冈部，冈部惊讶地低头看她。",
    ),
    _asset(
        "kagari-name-reveal-v1",
        "docs/assets/galgame-runaway-cgs/15-kagari-name-reveal-group-v1.png",
        "冈部篝自我介绍",
        "冈部篝自我介绍后，屋顶众人震惊地望向她与冈部。",
    ),
    _asset(
        "kagari-imitation-v5",
        "docs/assets/galgame-runaway-cgs/13-kagari-hououin-imitation-v5.png",
        "篝的凤凰院凶真模仿秀",
        "单时光机屋顶上，红发冈部篝摆出凤凰院凶真的交叉前臂姿势。",
    ),
    _asset(
        "suzuha-arrival-v1",
        "docs/assets/galgame-runaway-cgs/16-suzuha-second-machine-arrival-v1.png",
        "第二台时光机到达",
        "双时光机屋顶上，铃羽抵达并令众人惊讶回望。",
    ),
    _asset(
        "mother-identity-v2",
        "docs/assets/galgame-runaway-cgs/14-mother-identity-stop-v2.png",
        "禁止追问未来",
        "铃羽转向篝与众人，严厉制止对母亲身份的追问。",
    ),
    _asset(
        "lab-group-reaction-v1",
        "docs/assets/galgame-runaway-cgs/17-lab-group-reaction-v1.png",
        "实验室众人注视",
        "实验室众人集中视线，进行沉默推理与集体反应。",
    ),
    _asset(
        "father-daughter-storytime",
        "docs/assets/galgame-runaway-cgs/02-father-daughter-storytime.png",
        "临时爸爸",
        "实验室暖光中，篝依偎在冈部身边听他读故事。",
    ),
    _asset(
        "cleaning-sergeant",
        "docs/assets/galgame-runaway-cgs/09-cleaning-sergeant.png",
        "扫除曹长驾到",
        "天王寺裕吾闯入实验室，侧身指向冈部与桶子严厉训话。",
    ),
    _asset(
        "suzuha-end-it",
        "docs/assets/galgame-runaway-cgs/06-suzuha-end-it.png",
        "果然还是结束这一切吧",
        "铃羽含泪直视前方，做出痛苦而决绝的决定。",
    ),
    _asset(
        "kagari-rejects-mother",
        "docs/assets/galgame-runaway-cgs/03-kagari-rejects-mother.png",
        "妈妈不喜欢我",
        "篝含泪倔强地说出伤人的话，铃羽严肃地面对她。",
    ),
    _asset(
        "group-rebukes-kagari-v1",
        "docs/assets/galgame-runaway-cgs/18-group-rebukes-kagari-v1.png",
        "众人制止篝",
        "实验室众人严肃而担忧地制止情绪失控的冈部篝。",
    ),
    _asset(
        "kagari-remembers-mother",
        "docs/assets/galgame-runaway-cgs/04-kagari-remembers-mother.png",
        "想起妈妈",
        "篝哭着道歉，真由理与红莉栖在实验室里安慰她。",
    ),
    _asset(
        "suzuha-maho-v1",
        "docs/assets/galgame-runaway-cgs/19-suzuha-maho-duo-v1.png",
        "铃羽与真帆",
        "屋顶上，铃羽与真帆认真讨论返回未来的选择。",
    ),
    _asset(
        "rooftop-farewell",
        "docs/assets/galgame-runaway-cgs/05-rooftop-farewell.png",
        "屋顶告别",
        "篝在时间机器舱门前回头挥手，铃羽等待登舱。",
    ),
    _asset(
        "harem-chaos-finale",
        "docs/assets/galgame-runaway-cgs/10-harem-chaos-finale.png",
        "大家都是妈妈？",
        "众人误解成全员都是篝的妈妈，冈部被围在结尾的混乱中心。",
    ),
)


def _event(
    key: str,
    asset_key: str,
    start_ms: int,
    end_ms: int | None,
    *,
    transition_ms: int = 450,
    overlay: bool = False,
) -> dict[str, Any]:
    return {
        "key": key,
        "assetKey": asset_key,
        "startMs": start_ms,
        "endMs": end_ms,
        "transitionMs": transition_ms,
        "displayMode": "overlay" if overlay else "fullscreen",
        "fit": "contain" if overlay else "cover",
        "overlay": {
            "x": 50,
            "y": 50,
            "width": 40.825 if overlay else 60,
            "opacity": 1,
            "placement": "frontOfCharacters",
        },
    }


CG_EVENTS = (
    _event("q-prep", "q-prep", 12_000, None, transition_ms=220, overlay=True),
    _event("q-laugh", "q-laugh", 15_592, None, transition_ms=220, overlay=True),
    _event("q-cough", "q-cough", 22_571, 27_843, transition_ms=220, overlay=True),
    _event("roundtable-1", "roundtable-maho-v2", 341_612, 364_948),
    _event("kagari-arrival", "kagari-arrival", 388_383, 396_383),
    _event("kagari-hugs-okabe", "kagari-hugs-okabe", 416_108, 423_872),
    _event("kagari-name-reveal", "kagari-name-reveal-v1", 441_678, 450_933),
    _event("kagari-imitation", "kagari-imitation-v5", 593_385, 600_885),
    _event("suzuha-arrival", "suzuha-arrival-v1", 653_198, 661_198),
    _event("mother-identity", "mother-identity-v2", 783_714, 791_346),
    _event("lab-group-stare", "lab-group-reaction-v1", 836_994, 840_018),
    _event("lab-group-surprise", "lab-group-reaction-v1", 924_970, 926_202),
    _event("storytime-1", "father-daughter-storytime", 1_096_781, 1_104_781),
    _event("storytime-2", "father-daughter-storytime", 1_141_727, 1_147_632),
    _event("cleaning-1", "cleaning-sergeant", 1_233_804, 1_241_304),
    _event("cleaning-2", "cleaning-sergeant", 1_314_530, 1_319_935),
    _event("suzuha-end-it", "suzuha-end-it", 1_389_315, 1_392_725),
    _event("kagari-rejects-mother", "kagari-rejects-mother", 1_442_273, 1_449_773),
    _event("group-rebukes-kagari", "group-rebukes-kagari-v1", 1_454_555, 1_462_852),
    _event("kagari-remembers-mother", "kagari-remembers-mother", 1_562_135, 1_570_135),
    _event("suzuha-maho", "suzuha-maho-v1", 1_608_017, 1_611_573),
    _event("rooftop-farewell", "rooftop-farewell", 1_655_044, 1_663_044),
    _event("harem-chaos-finale", "harem-chaos-finale", 1_763_485, None),
)

CG_EVENT_STARTS = frozenset(event["startMs"] for event in CG_EVENTS)

# 兼容旧的只读导入；V7 的实现和审计使用分离的 CG_ASSETS / CG_EVENTS。
CG_SPECS = CG_ASSETS
