from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceCriterion,
    AcceptanceDocument,
    AcceptanceTemplateOut,
)


def criterion(identity, title, requirement, method="ai", required=True, reference=""):
    return AcceptanceCriterion(
        id=identity,
        title=title,
        requirement=requirement,
        method=method,
        required=required,
        reference_label=reference,
    )


def builtin_templates():
    specs = criterion(
        "specifications", "输出规格", "文件可解码，并满足配置的尺寸、画幅及时长。", "automatic"
    )
    identity = criterion(
        "identity",
        "角色外观一致",
        "脸型、发型和标志性配饰与角色基准一致；无法辨认时说明。",
        reference="角色基准图",
    )
    action = criterion(
        "action",
        "动作与道具",
        "完成动作说明中的关键动作，道具接触自然，不无故消失或穿透。",
        reference="动作参考",
    )
    emotion = criterion("emotion", "表演与情绪", "符合镜头目的与预期情绪。", "manual", False)
    groups = [
        ("video", "视频镜头通用", [specs, identity, action, emotion]),
        (
            "character",
            "角色与画风",
            [
                identity,
                criterion(
                    "costume", "服装与配饰", "服装、配饰与指定参考一致。", reference="服装参考"
                ),
                criterion(
                    "style", "画风稳定", "比例、线条及画风与参考相符。", reference="风格参考"
                ),
            ],
        ),
        (
            "continuity",
            "动作与连续性",
            [
                action,
                criterion(
                    "physics",
                    "空间与物理关系",
                    "身体结构、物体接触与运动关系可信；抽样不能确认的内容交人工。",
                ),
                criterion(
                    "transition",
                    "镜头衔接",
                    "人工对照前后镜头，检查动作、视线与道具状态。",
                    "manual",
                ),
            ],
        ),
        (
            "sound",
            "音画与台词",
            [
                AcceptanceCriterion(
                    id="dialogue",
                    title="台词与字幕",
                    requirement="核对台词、说话人及字幕时间轴。",
                    kinds=["audio", "video", "text"],
                    method="manual",
                ),
                AcceptanceCriterion(
                    id="sync",
                    title="声音与口型",
                    requirement="人工播放检查声音清晰度和音画同步。",
                    kinds=["audio", "video"],
                    method="manual",
                ),
            ],
        ),
        (
            "story",
            "剧情与表达",
            [
                AcceptanceCriterion(
                    id="story",
                    title="信息与因果",
                    requirement="关键信息完整，因果清晰。",
                    kinds=["text", "video"],
                    method="manual",
                ),
                emotion,
            ],
        ),
        ("blank", "空白模板", []),
    ]
    return [
        AcceptanceTemplateOut(
            id=f"builtin:{key}",
            title=title,
            builtin=True,
            document=AcceptanceDocument(title=title, criteria=items),
        )
        for key, title, items in groups
    ]
