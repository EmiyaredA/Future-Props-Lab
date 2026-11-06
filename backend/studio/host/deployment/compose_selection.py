"""Select the registered Compose files from explicit deployment configuration."""

from pathlib import Path

from .deployment_preflight import service_env

# Later feature files extend mounts and commands in their owning service files.
SERVICE_FILES = (
    ("models", ("models",)),
    ("integrations", ("integrations",)),
    ("thought", ("thought",)),
    ("project-owners", ("visual", "galgame")),
    ("creative", ("creative",)),
    ("presentation", ("presentation",)),
    ("annotation", ("annotation",)),
    ("video", ("video",)),
    ("motion", ("motion",)),
    ("director", ("director",)),
    ("interview", ("interview",)),
    ("tools", ("tools",)),
    ("amadeus", ("amadeus",)),
    ("agent-runtime", ("agent-runtime",)),
    ("remote", ("remote",)),
)

FEATURE_FILES = (
    ("remote-guacd", ("remote",), ("FPL_GUACD_IMAGE",)),
    (
        "remote-settings",
        ("remote",),
        (
            "FPL_REMOTE_SETUP_OPTIONS",
            "FPL_IDENTITY_CLOUD_PROJECTION_DIR",
            "FPL_REMOTE_CLOUD_PROJECTION_DIR",
            "FPL_CLOUD_SETTINGS_COMMIT_DIR",
        ),
    ),
    ("galgame-snapshots", ("galgame",), ("FPL_GALGAME_ARCHIVE_KEY",)),
    ("visual-snapshots", ("visual",), ("FPL_VISUAL_ARCHIVE_KEY",)),
    ("visual-generation", ("visual", "models"), ("FPL_VISUAL_GENERATION_KEY",)),
    ("visual-assistant", ("visual", "models"), ("FPL_VISUAL_ASSISTANT_SETTLEMENT_KEY",)),
    (
        "video-visual-handoff",
        ("video", "visual"),
        ("FPL_VIDEO_SEGMENT_VISUAL_KEY", "FPL_VISUAL_SEGMENT_ASSETS_KEY"),
    ),
    ("tools-native", ("tools",), ("FPL_TOOLS_NATIVE_CONFIG",)),
    ("interview-native", ("interview",), ("FPL_INTERVIEW_NATIVE_OPTIONS",)),
    ("amadeus-native", ("amadeus",), ("FPL_AMADEUS_NATIVE_CONFIG",)),
)


def resolve_files(base: Path, environment: dict[str, str]) -> tuple[Path, ...]:
    selected = [base]

    def add(name):
        path = base.with_name(f"{name}.compose.yaml")
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"已选择 {name} 但缺少匹配的服务部署清单")
        selected.append(path)

    management = base.with_name("management.compose.yaml")
    if environment.get("FPL_MANAGEMENT_IMAGE") or management.exists() or management.is_symlink():
        add("management")

    for name, services in SERVICE_FILES:
        images = [bool(environment.get(service_env(service, "IMAGE"))) for service in services]
        if any(images):
            if not all(images):
                raise ValueError(f"{name} 缺少配套服务镜像")
            add(name)

    if environment.get("FPL_CREATIVE_IMAGE") and not environment.get("FPL_INTEGRATIONS_IMAGE"):
        raise ValueError("Creative 缺少配套 Integrations 镜像")
    if environment.get("FPL_REMOTE_IMAGE") and not environment.get("FPL_GUACD_IMAGE"):
        raise ValueError("Remote 缺少配套 Guacamole 镜像")
    for name, services, keys in FEATURE_FILES:
        if any(environment.get(key) for key in keys):
            if not all(environment.get(key) for key in keys):
                raise ValueError(f"{name} 的部署配置不完整")
            if not all(environment.get(service_env(service, "IMAGE")) for service in services):
                raise ValueError(f"{name} 缺少配套服务镜像")
            add(name)
    return tuple(selected)
