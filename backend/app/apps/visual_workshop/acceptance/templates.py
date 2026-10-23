from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceCriterion,
    AcceptanceDocument,
    AcceptanceTemplateOut,
)


def builtin_templates():
    return [
        AcceptanceTemplateOut(
            id="builtin:motion-transfer",
            title="动作迁移",
            builtin=True,
            document=AcceptanceDocument(
                title="动作迁移",
                criteria=[
                    AcceptanceCriterion(
                        id="specifications",
                        title="输出规格",
                        requirement="文件可解码，并满足配置的尺寸、画幅及时长。",
                        method="automatic",
                    ),
                    AcceptanceCriterion(
                        id="identity",
                        title="角色外观一致",
                        requirement="迁移后的角色与角色基准图一致，脸型、发型、服装和配饰保持稳定；遮挡或无法辨认时说明。",
                        method="ai",
                        reference_label="角色基准图",
                    ),
                    AcceptanceCriterion(
                        id="action",
                        title="动作与道具",
                        requirement="对照原动作视频的参考画面，检查关键姿态、肢体朝向与道具接触；抽样未覆盖或无法判断的动作留待人工确认。",
                        method="ai",
                        reference_label="原动作视频",
                    ),
                    AcceptanceCriterion(
                        id="motion-continuity",
                        title="动作连贯与节奏",
                        requirement="完整播放原动作视频与迁移结果，核对动作顺序、速度、停顿和衔接；身体与道具不应无故跳变、穿透或消失。",
                        kinds=["video"],
                        method="manual",
                        reference_label="原动作视频",
                    ),
                ],
            ),
        )
    ]
