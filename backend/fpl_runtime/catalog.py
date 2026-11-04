"""Independently released units of the single-host FPL deployment."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Service:
    id: str
    label: str
    page_roots: tuple[str, ...] = ()
    dependencies: tuple[str, ...] = ()
    host_capabilities: tuple[str, ...] = ()


SERVICES = (
    Service("gateway", "网站网关"),
    Service(
        "management",
        "管理中台",
        ("/management",),
        ("identity", "models"),
        ("deployment", "public_access"),
    ),
    Service("identity", "账号与登录", ("/login", "/account")),
    Service("portal", "FPL 门户", ("/", "/home", "/apps", "/cloud-control", "/docs.html", "/docs")),
    Service(
        "agents",
        "Agent 工作台",
        ("/agents",),
        ("identity", "agent-runtime"),
        ("agent_sources", "workbench_execution"),
    ),
    Service(
        "remote", "远程桌面", dependencies=("identity",), host_capabilities=("remote_desktop",)
    ),
    Service(
        "visual",
        "视觉创作工坊",
        ("/apps/visual-workshop",),
        ("assets", "models", "rendering", "tools"),
    ),
    Service(
        "thought",
        "思绪工坊",
        ("/apps/thought-workshop",),
        ("identity", "assets", "models", "integrations"),
    ),
    Service(
        "galgame",
        "Galgame 工坊",
        ("/apps/galgame-workshop",),
        ("assets", "models", "rendering", "tools", "annotation"),
    ),
    Service(
        "video",
        "视频剪辑工坊",
        ("/apps/video-editor",),
        ("assets", "models", "rendering", "tools", "visual"),
    ),
    Service(
        "motion", "特效制作工坊", ("/apps/motion-compositor",), ("assets", "rendering", "video")
    ),
    Service(
        "presentation", "演示文稿工坊", ("/apps/presentation-workshop",), ("assets", "rendering")
    ),
    Service(
        "annotation", "录音标注工坊", ("/apps/audio-annotation",), ("assets", "models", "rendering")
    ),
    Service("director", "导演台", ("/apps/director-desk",), ("assets", "rendering")),
    Service("interview", "面试助手", ("/apps/interview-assistant",), ("assets", "agent-runtime")),
    Service("creative", "创意工坊", ("/creative-workshop",), ("identity", "integrations")),
    Service("assets", "文件与素材", ("/files",)),
    Service(
        "models",
        "模型服务",
        ("/model-service", "/model-test", "/model-call-logs"),
        ("assets",),
        ("local_models",),
    ),
    Service("rendering", "媒体渲染", dependencies=("assets",)),
    Service(
        "agent-runtime",
        "编程智能体",
        ("/code-agents",),
        ("identity", "integrations"),
        ("code_agents", "mcp_stdio", "sandbox_scripts"),
    ),
    Service("integrations", "集成中心", ("/integrations",), host_capabilities=("mcp_stdio",)),
    Service("amadeus", "Amadeus", dependencies=("agent-runtime", "integrations", "assets")),
    Service("tools", "工具导航", ("/tools",), ("assets", "rendering"), ("host_tools",)),
)
BY_ID = {service.id: service for service in SERVICES}


def service_by_id(identity: str) -> Service:
    try:
        return BY_ID[identity]
    except KeyError:
        raise ValueError("未登记的 FPL 服务") from None


def validate_catalog() -> None:
    if len(BY_ID) != len(SERVICES):
        raise ValueError("服务 ID 重复")
    pages = [page for service in SERVICES for page in service.page_roots]
    if len(set(pages)) != len(pages):
        raise ValueError("页面根路径归属重复")
    for service in SERVICES:
        if service.id in service.dependencies or set(service.dependencies) - BY_ID.keys():
            raise ValueError(f"{service.id} 的服务依赖无效")


validate_catalog()
