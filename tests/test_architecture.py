from __future__ import annotations

import ast
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = REPO_ROOT / "backend" / "app"
WEB_SRC = REPO_ROOT / "web" / "src"

# A long file only hurts the file it lives in, so the per-file gate is deliberately
# loose. What has to stay reviewable is one directory level, which is why the
# budget below governs bulk instead.
SOURCE_SOFT_LIMITS = {".py": 900, ".ts": 1_000, ".tsx": 1_000, ".css": 800}
TEST_SOFT_LIMIT = 1_200
DIRECTORY_LINE_BUDGET = 6_000
MECHANICAL_SHARD_PATTERN = re.compile(
    r"-(?:foundation|components|interactions|part\d*|base|extra|misc)$"
)
# Roots the vertical slice restructure moves code into. The budget, naming and
# barrel gates govern this structure; the roots being emptied keep the older
# rules until their phase moves them.
RESTRUCTURED_ROOTS = (
    WEB_SRC / "apps",
    WEB_SRC / "console",
    BACKEND_APP / "apps",
    BACKEND_APP / "console",
    BACKEND_APP / "capabilities",
)
WEB_APP_UNITS = (
    "agent-workbench",
    "audio-annotation",
    "galgame-workshop",
    "presentation-workshop",
    "thought-workshop",
    "video-editor",
    "motion-compositor",
    "visual-workshop",
    "director-desk",
)
# Only explicit public handoffs may cross app boundaries.
ALLOWED_APP_HANDOFFS = {
    ("video-editor", "visual-workshop"),
    ("motion-compositor", "video-editor"),
}

FORBIDDEN_BACKEND_DIRECTORIES = {"domain", "platform", "product", "services"}
# Hard-cut legacy package roots from the runtime/capabilities restructure.
REMOVED_BACKEND_PACKAGES = {
    "accounts",
    "agents",
    "concurrency",
    "core",
    "files",
    "media_rendering",
}
REMOVED_BACKEND_IMPORT_PREFIXES = (
    "app.accounts",
    "app.agents",
    "app.concurrency",
    "app.core",
    "app.files",
    "app.media_rendering",
    "app.llm.transcription",
)
BUSINESS_BACKEND_PACKAGES = (
    "demo_runtime",
    "integrations",
    "llm",
    "tool_navigation",
)
ROUTE_FORBIDDEN_IMPORTS = ("app.runtime.db", "app.models", "db", "sqlalchemy")
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace", "websocket"}
ROOT_PROBE_PATHS = {"/health", "/ready"}


def _backend_route_files() -> list[Path]:
    roots = [
        BACKEND_APP / "console" / "routes",
        BACKEND_APP / "llm" / "routes",
        BACKEND_APP / "capabilities" / "asset_store" / "routes",
        *(BACKEND_APP / "apps").glob("*/routes"),
    ]
    files = [path for root in roots if root.is_dir() for path in _python_files(root)]
    for package in ("integrations", "tool_navigation", "demo_runtime"):
        candidate = BACKEND_APP / package / "routes.py"
        if candidate.is_file():
            files.append(candidate)
    return sorted(files)


FROM_IMPORT_PATTERN = re.compile(r"\bfrom\s+[\"']([^\"']+)[\"']")
SIDE_EFFECT_IMPORT_PATTERN = re.compile(r"^\s*import\s+[\"']([^\"']+)[\"']", re.MULTILINE)
DYNAMIC_IMPORT_PATTERN = re.compile(r"\bimport\(\s*[\"']([^\"']+)[\"']\s*\)")
APP_SHELL_SELECTOR_PATTERN = re.compile(
    r"\.(?:studio-(?:shell|sidebar|main|lock)|sidebar-footer|nav-(?:group|primary|sub)|auth-)"
)
FEATURE_SELECTOR_PATTERN = re.compile(
    r"\.(?:model|provider|playground|generation-test|log-|conversation|chat-message)"
)


def _python_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def _restructured_directories() -> list[Path]:
    return sorted(
        directory
        for root in RESTRUCTURED_ROOTS
        if root.is_dir()
        for directory in [root, *root.rglob("*")]
        if directory.is_dir() and "__pycache__" not in directory.parts
    )


def _python_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module)
    return imports


def _matches_module(module: str, prefix: str) -> bool:
    return module == prefix or module.startswith(f"{prefix}.")


def _relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
    except ValueError:
        return False
    return True


def _web_imports(path: Path) -> set[str]:
    source = path.read_text(encoding="utf-8")
    imports: set[str] = set()
    for pattern in (FROM_IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN):
        imports.update(pattern.findall(source))
    return imports


def _web_runtime_imports(path: Path) -> set[str]:
    """TypeScript erases type-only imports; only emitted imports can cycle at runtime."""
    source = path.read_text(encoding="utf-8")
    imports = set(SIDE_EFFECT_IMPORT_PATTERN.findall(source))
    imports.update(DYNAMIC_IMPORT_PATTERN.findall(source))
    statement = re.compile(
        r"\b(?:import|export)\s+(.*?)\s+from\s+[\"']([^\"']+)[\"']",
        re.DOTALL,
    )
    for match in statement.finditer(source):
        clause = match.group(1).strip()
        if clause.startswith("type "):
            continue
        if clause.startswith("{") and all(
            item.strip().startswith("type ") for item in clause[1:-1].split(",") if item.strip()
        ):
            continue
        imports.add(match.group(2))
    return imports


def _resolve_web_import(source: Path, specifier: str) -> Path | None:
    aliases = {
        "@app": WEB_SRC / "app",
        "@features": WEB_SRC / "features",
        "@generated": WEB_SRC / "generated",
        "@platform": WEB_SRC / "platform",
        "@shared": WEB_SRC / "shared",
    }
    for alias, directory in aliases.items():
        if specifier == alias or specifier.startswith(f"{alias}/"):
            suffix = specifier.removeprefix(alias).lstrip("/")
            return (directory / suffix).resolve()
    if specifier.startswith("."):
        return (source.parent / specifier).resolve()
    return None


def _resolve_web_module(source: Path, specifier: str) -> Path | None:
    target = _resolve_web_import(source, specifier)
    if target is None:
        return None
    candidates = (
        target,
        target.with_suffix(".ts"),
        target.with_suffix(".tsx"),
        target / "index.ts",
        target / "index.tsx",
    )
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def test_workspace_models_are_registered_for_tenant_scoping() -> None:
    from app.capabilities.asset_store.upgrade_records import AccountStorageUpgradeRoot
    from app.console.models import (
        ManagementApiKey,
        ModelTemplateSyncItem,
        RuntimeAdmission,
        SecurityAuditEvent,
    )
    from app.orm import TENANT_MODELS
    from app.runtime.orm_base import Base

    account_governance_models = {
        ModelTemplateSyncItem,
        RuntimeAdmission,
        ManagementApiKey,
        SecurityAuditEvent,
        AccountStorageUpgradeRoot,
    }
    workspace_models = {
        mapper.class_ for mapper in Base.registry.mappers if hasattr(mapper.class_, "owner_user_id")
    }
    missing = workspace_models - set(TENANT_MODELS) - account_governance_models
    assert not missing, "带 owner_user_id 的业务模型必须注册租户过滤：" + ", ".join(
        sorted(model.__name__ for model in missing)
    )


def test_galgame_asset_query_keys_have_one_owner() -> None:
    owner = WEB_SRC / "features" / "galgame-workshop" / "queryKeys.ts"
    literals = (
        '"galgame-project-assets"',
        '"galgame-asset-overview"',
        '"galgame-package-manifest"',
    )
    violations: list[str] = []
    for path in sorted((WEB_SRC / "features" / "galgame-workshop").rglob("*.ts*")):
        if path == owner:
            continue
        source = path.read_text(encoding="utf-8")
        if any(literal in source for literal in literals):
            violations.append(_relative(path))
    assert not violations, "Galgame 素材查询键只能由 queryKeys.ts 定义：\n" + "\n".join(violations)


def test_feature_query_keys_have_one_owner() -> None:
    owners = {
        WEB_SRC / "features" / "models" / "queryKeys.ts": (
            '"model-catalog"',
            '"model-categories"',
            '"model-logs"',
            '"model-test-conversations"',
            '"model-test-generation-options"',
            '"model-test-transcription-options"',
        ),
        WEB_SRC / "features" / "visual-workshop" / "queryKeys.ts": (
            '"visual-workshop-projects"',
            '"visual-workshop-project"',
            '"visual-workshop-canvas"',
            '"visual-generation-options"',
            '"visual-generation-tasks"',
            '"visual-assistant-conversations"',
        ),
        WEB_SRC / "features" / "audio-annotation" / "queryKeys.ts": (
            '"audio-annotation-projects"',
            '"audio-annotation-project"',
            '"audio-annotation-document"',
            '"audio-annotation-waveform"',
            '"audio-annotation-library-audio"',
        ),
        WEB_SRC / "features" / "thought-workshop" / "queryKeys.ts": ('["thought-workshop"]',),
    }
    allowed_route_metadata = {
        WEB_SRC / "features" / "visual-workshop" / "module.ts",
        WEB_SRC / "features" / "audio-annotation" / "module.ts",
    }
    violations: list[str] = []
    for owner, literals in owners.items():
        for path in sorted((WEB_SRC / "features").rglob("*.ts*")):
            if path == owner or path in allowed_route_metadata:
                continue
            source = path.read_text(encoding="utf-8")
            for literal in literals:
                if literal in source:
                    violations.append(f"{_relative(path)} owns {literal}")
    assert not violations, "Feature 缓存键字面量只能由所属 queryKeys.ts 定义：\n" + "\n".join(
        violations
    )


def test_backend_routes_do_not_own_persistence() -> None:
    violations: list[str] = []
    for path in _backend_route_files():
        for module in _python_imports(path):
            if any(_matches_module(module, prefix) for prefix in ROUTE_FORBIDDEN_IMPORTS):
                violations.append(f"{_relative(path)} imports {module}")
    assert not violations, "路由层不得直接依赖持久化实现：\n" + "\n".join(violations)


def test_management_api_key_mutations_require_browser_session_auth() -> None:
    path = BACKEND_APP / "console" / "routes" / "accounts.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    handlers = {
        node.name: node
        for node in tree.body
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
    }
    for name in (
        "add_api_key",
        "remove_api_key",
        "renew_api_key_expiration",
        "delete_api_key_record",
    ):
        calls = {
            node.func.id
            for node in ast.walk(handlers[name])
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert "_browser_auth" in calls, f"{name} 必须显式要求浏览器 Session 与 CSRF 治理"


def test_business_modules_do_not_depend_on_fastapi_upload_file() -> None:
    violations: list[str] = []
    route_roots = [
        BACKEND_APP / "console" / "routes",
        BACKEND_APP / "llm" / "routes",
        BACKEND_APP / "capabilities" / "asset_store" / "routes",
        *(BACKEND_APP / "apps").glob("*/routes"),
    ]
    for path in _python_files(BACKEND_APP):
        if any(_is_within(path, root) for root in route_roots if root.is_dir()):
            continue
        # Package-owned single-file route adapters (integrations / tool_navigation / demo_runtime).
        if path.name == "routes.py" and path.parent.parent == BACKEND_APP:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.module != "fastapi":
                continue
            if any(alias.name == "UploadFile" for alias in node.names):
                violations.append(f"{_relative(path)}:{node.lineno}")
    assert not violations, "业务模块必须依赖 files.IncomingFile，而不是 FastAPI UploadFile：\n" + (
        "\n".join(violations)
    )


def test_workspace_context_has_no_ambient_fallback() -> None:
    source = (BACKEND_APP / "orm.py").read_text(encoding="utf-8")
    assert "ContextVar" not in source
    assert "current_owner_user_id" not in source


def test_backend_production_code_has_no_wildcard_imports() -> None:
    violations: list[str] = []
    for path in _python_files(BACKEND_APP):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and any(alias.name == "*" for alias in node.names):
                violations.append(f"{_relative(path)}:{node.lineno}")
    assert not violations, "后端生产代码不得使用通配符导入：\n" + "\n".join(violations)


def test_migrations_are_runtime_independent() -> None:
    violations: list[str] = []
    for path in _python_files(REPO_ROOT / "db" / "migrations"):
        for module in _python_imports(path):
            if _matches_module(module, "app"):
                violations.append(f"{_relative(path)} imports {module}")
    assert not violations, "迁移层不得反向导入运行时 app：\n" + "\n".join(violations)


def test_background_runner_lifecycle_is_not_owned_by_llm() -> None:
    violations: list[str] = []
    for path in _python_files(BACKEND_APP):
        source = path.read_text(encoding="utf-8")
        if "PollingGenerationRunner" in source or "generation_runtime.worker" in source:
            violations.append(_relative(path))
    assert not violations, "通用 Runner 生命周期必须归属 concurrency：\n" + "\n".join(violations)


def test_generation_features_use_the_shared_task_driver() -> None:
    runners = (
        BACKEND_APP / "llm" / "playground" / "generation_runner.py",
        BACKEND_APP / "apps" / "visual_workshop" / "generation_runner.py",
    )
    violations = [
        _relative(path)
        for path in runners
        if "GenerationTaskDriver(" not in path.read_text(encoding="utf-8")
    ]
    assert not violations, "生成任务状态机必须由 GenerationTaskDriver 统一编排：\n" + "\n".join(
        violations
    )


def test_secret_hints_and_provider_categories_have_one_owner() -> None:
    hint_owner = BACKEND_APP / "runtime" / "secret_hints.py"
    hint_violations = [
        _relative(path)
        for path in _python_files(BACKEND_APP)
        if path != hint_owner and "value[-4:]" in path.read_text(encoding="utf-8")
    ]
    category_violations = [
        _relative(path)
        for path in _python_files(BACKEND_APP / "llm" / "catalog")
        if path.name != "metadata.py"
        and "def _categories_for_provider" in path.read_text(encoding="utf-8")
    ]
    assert not hint_violations, "加密密钥提示只能由 runtime.secret_hints 生成：\n" + "\n".join(
        hint_violations
    )
    assert not category_violations, "供应商默认类别只能由 catalog.metadata 定义：\n" + (
        "\n".join(category_violations)
    )


def test_backend_avoids_generic_abstract_layer_directories() -> None:
    violations = sorted(
        _relative(path)
        for path in BACKEND_APP.rglob("*")
        if path.is_dir() and path.name in FORBIDDEN_BACKEND_DIRECTORIES
    )
    assert not violations, "请按具体能力命名后端目录：\n" + "\n".join(violations)


def test_orm_models_only_depend_on_allowed_runtime_primitives() -> None:
    allowed = {
        "app.runtime.orm_base",
        "app.runtime.ids",
        "app.runtime.time",
    }
    roots = [
        BACKEND_APP / "runtime" / "project_operations.py",
        BACKEND_APP / "capabilities" / "asset_store" / "models.py",
        BACKEND_APP / "integrations" / "models.py",
        BACKEND_APP / "tool_navigation" / "models.py",
        *(BACKEND_APP / "apps").glob("*/models.py"),
        *(
            (BACKEND_APP / "console" / "models").glob("*.py")
            if (BACKEND_APP / "console" / "models").is_dir()
            else []
        ),
        *(
            (BACKEND_APP / "llm" / "models").rglob("*.py")
            if (BACKEND_APP / "llm" / "models").is_dir()
            else []
        ),
    ]
    violations: list[str] = []
    for path in roots:
        if not path.is_file() or path.name == "__init__.py":
            continue
        for module in _python_imports(path):
            if _matches_module(module, "app.runtime") and module not in allowed:
                violations.append(f"{_relative(path)} imports {module}")
    assert not violations, "ORM 模型只能依赖 runtime.orm_base / ids / time：\n" + "\n".join(
        violations
    )


def test_backend_production_packages_have_no_dependency_cycles() -> None:
    packages = {
        path.name
        for path in BACKEND_APP.iterdir()
        if path.is_dir() and path.name != "routes" and (path / "__init__.py").is_file()
    }
    graph: dict[str, set[str]] = {package: set() for package in packages}
    for package in packages:
        for path in _python_files(BACKEND_APP / package):
            # Protocol adapters may call into peer packages; they used to live in the
            # exempted top-level routes/ tree. Ignore the same role under package routes/
            # directories and package-root routes.py files.
            rel = path.relative_to(BACKEND_APP / package)
            if "routes" in rel.parts or rel.name == "routes.py":
                continue
            for module in _python_imports(path):
                parts = module.split(".")
                if len(parts) >= 2 and parts[0] == "app" and parts[1] in packages:
                    target = parts[1]
                    if target == package:
                        continue
                    # Console ORM used to live under top-level models/. Business packages may
                    # import those shapes without forming a console↔llm/demo cycle; console
                    # governance already depends on llm for template/log use cases.
                    if target == "console" and module.startswith("app.console.models"):
                        continue
                    graph[package].add(target)

    visiting: list[str] = []
    visited: set[str] = set()
    cycles: set[tuple[str, ...]] = set()

    def visit(package: str) -> None:
        if package in visited:
            return
        if package in visiting:
            start = visiting.index(package)
            cycles.add(tuple(visiting[start:] + [package]))
            return
        visiting.append(package)
        for target in sorted(graph[package]):
            visit(target)
        visiting.pop()
        visited.add(package)

    for package in sorted(packages):
        visit(package)
    assert not cycles, "后端生产包不得形成强依赖环：\n" + "\n".join(
        " -> ".join(cycle) for cycle in sorted(cycles)
    )


def test_media_rendering_and_galgame_keep_feature_boundaries() -> None:
    shared_violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP / "capabilities" / "media_rendering")
        for module in _python_imports(path)
        if _matches_module(module, "app.video_editor")
        or _matches_module(module, "app.apps.video_editor")
        or _matches_module(module, "app.apps.galgame_workshop")
    ]
    galgame_violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP / "apps" / "galgame_workshop")
        if path.name not in {"video_handoff.py", "video_handoff_runner.py"}
        for module in _python_imports(path)
        if _matches_module(module, "app.video_editor")
        or _matches_module(module, "app.apps.video_editor")
    ]
    violations = shared_violations + galgame_violations
    assert not violations, "共享渲染和 Galgame 直接导出不得依赖视频编辑器实现：\n" + "\n".join(
        violations
    )


def test_agent_harness_is_provider_independent() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP / "capabilities" / "agents" / "harness")
        for module in _python_imports(path)
        if _matches_module(module, "app.llm.providers")
    ]
    assert not violations, "Agent Harness 不得依赖具体供应商：\n" + "\n".join(violations)


def test_transcription_consumers_do_not_depend_on_playground() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for root in (
            BACKEND_APP / "apps" / "audio_annotation",
            BACKEND_APP / "apps" / "galgame_workshop",
        )
        for path in _python_files(root)
        for module in _python_imports(path)
        if _matches_module(module, "app.llm.playground")
    ]
    assert not violations, "语音能力消费者不得依赖模型测试实现：\n" + "\n".join(violations)


def test_account_service_does_not_own_catalog_provisioning() -> None:
    imports = _python_imports(BACKEND_APP / "console" / "governance" / "service.py")
    assert not any(_matches_module(module, "app.llm") for module in imports)
    assert (BACKEND_APP / "console" / "governance" / "provisioning.py").is_file()


def test_public_files_have_independent_ownership() -> None:
    required = (
        BACKEND_APP / "capabilities" / "asset_store" / "assets.py",
        BACKEND_APP / "capabilities" / "asset_store" / "models.py",
        BACKEND_APP / "capabilities" / "asset_store" / "schemas" / "files.py",
    )
    assert all(path.is_file() for path in required), (
        "公共文件能力必须由 capabilities/asset_store 拥有"
    )
    assert not (BACKEND_APP / "visual_workshop" / "assets.py").exists()
    for route_name in ("file_management.py",):
        route = BACKEND_APP / "routes" / route_name
        if not route.exists():
            continue
        imports = _python_imports(route)
        assert "app.visual_workshop.assets" not in imports
        assert "app.apps.visual_workshop.assets" not in imports
    visual_routes = BACKEND_APP / "apps" / "visual_workshop" / "routes" / "__init__.py"
    assert visual_routes.is_file()
    imports = _python_imports(visual_routes)
    assert "app.visual_workshop.assets" not in imports
    assert "app.apps.visual_workshop.assets" not in imports


def test_removed_backend_packages_are_gone() -> None:
    remaining = sorted(name for name in REMOVED_BACKEND_PACKAGES if (BACKEND_APP / name).exists())
    assert not remaining, "阶段 1 已删除的旧包不得残留：\n" + "\n".join(remaining)


def test_removed_backend_import_prefixes_are_unused() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP)
        for module in _python_imports(path)
        for prefix in REMOVED_BACKEND_IMPORT_PREFIXES
        if _matches_module(module, prefix)
    ]
    assert not violations, "不得再导入已删除的旧包路径：\n" + "\n".join(violations)


def test_capabilities_do_not_depend_on_business_packages() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP / "capabilities")
        for module in _python_imports(path)
        for package in (*BUSINESS_BACKEND_PACKAGES, "apps", "console")
        if _matches_module(module, f"app.{package}")
    ]
    assert not violations, "capabilities 不得依赖业务包、apps 或 console：\n" + "\n".join(
        violations
    )


def test_console_does_not_depend_on_apps() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP / "console")
        for module in _python_imports(path)
        if _matches_module(module, "app.apps")
    ]
    assert not violations, "console 不得依赖 apps：\n" + "\n".join(violations)


def test_runtime_assembly_entrypoints_exist() -> None:
    assert (BACKEND_APP / "runtime" / "orm_base.py").is_file()
    assert (BACKEND_APP / "orm.py").is_file()
    assert (BACKEND_APP / "api.py").is_file()
    assert (BACKEND_APP / "capabilities" / "identity" / "principal.py").is_file()
    assert (BACKEND_APP / "capabilities" / "asset_store" / "storage.py").is_file()
    assert (BACKEND_APP / "console" / "governance" / "provisioning.py").is_file()
    assert (BACKEND_APP / "console" / "file_library" / "library_folder_archive.py").is_file()


def test_visual_assistant_has_no_function_local_app_imports() -> None:
    violations: list[str] = []
    for path in _python_files(BACKEND_APP / "apps" / "visual_workshop" / "assistant"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for function in (
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ):
            for node in ast.walk(function):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    violations.append(f"{_relative(path)}:{node.lineno}")
    assert not violations, "视觉助手不得在函数内动态导入：\n" + "\n".join(violations)


def test_backend_business_packages_have_no_function_local_app_imports() -> None:
    def exempt(relative: Path) -> bool:
        root = relative.parts[0]
        if root in {"routes", "schemas", "models", "runtime", "capabilities"}:
            return True
        if root == "apps":
            if relative.name == "models.py":
                return True
            return len(relative.parts) >= 3 and relative.parts[2] in {"routes", "schemas"}
        if root == "console":
            return len(relative.parts) >= 2 and relative.parts[1] in {"routes", "schemas"}
        if root == "llm":
            return len(relative.parts) >= 2 and relative.parts[1] in {"routes", "schemas"}
        if root in {"integrations", "tool_navigation", "demo_runtime"}:
            return relative.name in {"routes.py", "schemas.py", "models.py"}
        return False

    violations: list[str] = []
    for path in _python_files(BACKEND_APP):
        relative = path.relative_to(BACKEND_APP)
        if exempt(relative):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for function in (
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ):
            for node in ast.walk(function):
                if (
                    isinstance(node, ast.ImportFrom)
                    and node.module
                    and node.module.startswith("app.")
                ):
                    violations.append(f"{_relative(path)}:{node.lineno} imports {node.module}")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.startswith("app."):
                            violations.append(
                                f"{_relative(path)}:{node.lineno} imports {alias.name}"
                            )
    assert not violations, "业务包不得使用函数内 app.* 导入：\n" + "\n".join(violations)


def test_legacy_asset_root_is_only_resolved_by_storage_boundary() -> None:
    allowed = {
        BACKEND_APP / "runtime" / "config.py",
        BACKEND_APP / "capabilities" / "asset_store" / "storage.py",
        BACKEND_APP / "capabilities" / "asset_store" / "layout_migration.py",
    }
    violations = [
        _relative(path)
        for path in _python_files(BACKEND_APP)
        if path not in allowed and "visual_asset_path" in path.read_text(encoding="utf-8")
    ]
    assert not violations, "旧素材根目录只能由存储/迁移边界解析：\n" + "\n".join(violations)


def test_web_dependency_direction() -> None:
    layer_rules = {
        "platform": (WEB_SRC / "app", WEB_SRC / "features"),
        "shared": (WEB_SRC / "app", WEB_SRC / "features"),
        "features": (WEB_SRC / "app",),
    }
    violations: list[str] = []
    for layer, forbidden_targets in layer_rules.items():
        for path in sorted((WEB_SRC / layer).rglob("*")):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            for specifier in _web_imports(path):
                target = _resolve_web_import(path, specifier)
                if target is not None and any(
                    _is_within(target, directory) for directory in forbidden_targets
                ):
                    violations.append(f"{_relative(path)} imports {specifier}")
    assert not violations, "Web 依赖方向违规：\n" + "\n".join(violations)


def test_cross_feature_imports_use_public_entry() -> None:
    violations: list[str] = []
    features_root = WEB_SRC / "features"
    for path in sorted(features_root.rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        source_feature = path.relative_to(features_root).parts[0]
        for specifier in _web_imports(path):
            if not specifier.startswith("@features/"):
                continue
            segments = specifier.split("/")
            if len(segments) < 2 or segments[1] == source_feature:
                continue
            if len(segments) > 2:
                violations.append(f"{_relative(path)} imports {specifier}")
    assert not violations, "跨 feature 只能导入目标 feature 公共入口：\n" + "\n".join(violations)


def test_web_production_modules_have_no_import_cycles() -> None:
    files = sorted(
        path
        for path in WEB_SRC.rglob("*")
        if path.suffix in {".ts", ".tsx"} and not _is_within(path, WEB_SRC / "generated")
    )
    graph = {
        path: {
            target
            for specifier in _web_runtime_imports(path)
            if (target := _resolve_web_module(path, specifier)) in files
        }
        for path in files
    }
    visiting: list[Path] = []
    visited: set[Path] = set()
    cycles: set[tuple[str, ...]] = set()

    def visit(path: Path) -> None:
        if path in visited:
            return
        if path in visiting:
            start = visiting.index(path)
            cycle = visiting[start:] + [path]
            cycles.add(tuple(_relative(item) for item in cycle))
            return
        visiting.append(path)
        for target in sorted(graph[path]):
            visit(target)
        visiting.pop()
        visited.add(path)

    for path in files:
        visit(path)
    assert not cycles, "TypeScript 生产模块不得形成运行时导入循环：\n" + "\n".join(
        " -> ".join(cycle) for cycle in sorted(cycles)
    )


def test_feature_styles_do_not_reenter_the_app_shell() -> None:
    app_styles = (WEB_SRC / "app" / "styles.css").read_text(encoding="utf-8")
    assert not FEATURE_SELECTOR_PATTERN.search(app_styles), "业务样式不得重新堆入 app/styles.css"
    violations: list[str] = []
    for path in sorted((WEB_SRC / "features").rglob("*.css")):
        if APP_SHELL_SELECTOR_PATTERN.search(path.read_text(encoding="utf-8")):
            violations.append(_relative(path))
    assert not violations, "feature 样式不得覆盖应用壳选择器：\n" + "\n".join(violations)


def test_workshop_shell_does_not_depend_on_feature_implementation_or_styles() -> None:
    shell = WEB_SRC / "app" / "layout" / "WorkshopShell.tsx"
    violations = [
        specifier
        for specifier in _web_imports(shell)
        if specifier.endswith(".css")
        and (
            (target := _resolve_web_import(shell, specifier)) is not None
            and _is_within(target, WEB_SRC / "features")
        )
    ]
    assert not violations, "通用工坊壳不得依赖 feature 实现或样式：\n" + "\n".join(violations)


def test_business_routes_are_mounted_under_v1() -> None:
    routes_init = BACKEND_APP / "api.py"
    routes_tree = ast.parse(routes_init.read_text(encoding="utf-8"), filename=str(routes_init))
    prefixes: list[str] = []
    for node in ast.walk(routes_tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(
            isinstance(target, ast.Name) and target.id == "api_router" for target in targets
        ):
            continue
        value = node.value
        if not isinstance(value, ast.Call):
            continue
        for keyword in value.keywords:
            if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant):
                prefixes.append(keyword.value.value)
    assert prefixes == ["/v1"], "api_router 必须且只能使用 /v1 前缀"

    main_path = BACKEND_APP / "main.py"
    main_tree = ast.parse(main_path.read_text(encoding="utf-8"), filename=str(main_path))
    root_paths: set[str] = set()
    for node in ast.walk(main_tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            owner = decorator.func.value
            if (
                isinstance(owner, ast.Name)
                and owner.id == "app"
                and decorator.func.attr in HTTP_METHODS
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and isinstance(decorator.args[0].value, str)
            ):
                root_paths.add(decorator.args[0].value)
    assert root_paths == ROOT_PROBE_PATHS, "根级路由只能包含 /health 与 /ready"


def test_documented_core_directories_exist() -> None:
    required = (
        "backend/app/runtime",
        "backend/app/capabilities",
        "backend/app/capabilities/agents",
        "backend/app/capabilities/asset_store",
        "backend/app/capabilities/identity",
        "backend/app/capabilities/media_rendering",
        "backend/app/capabilities/transcription",
        "backend/app/console",
        "backend/app/console/file_library",
        "backend/app/console/governance",
        "backend/app/console/models",
        "backend/app/console/routes",
        "backend/app/console/schemas",
        "backend/app/apps",
        "backend/app/apps/presentation_workshop",
        "backend/app/apps/audio_annotation",
        "backend/app/apps/thought_workshop",
        "backend/app/apps/video_editor",
        "backend/app/apps/visual_workshop",
        "backend/app/apps/galgame_workshop",
        "backend/app/apps/director_desk",
        "backend/app/llm",
        "backend/app/integrations",
        "backend/app/demo_runtime",
        "backend/app/tool_navigation",
        "db/migrations/versions",
        "docs/architecture",
        "docs/operations",
        ".github/workflows",
        "scripts",
        "tests",
        "web/e2e",
        "web/src/app",
        "web/src/docs",
        "web/src/features",
        "web/src/generated",
        "web/src/platform",
        "web/src/shared",
        "web/tests",
    )
    missing = [path for path in required if not (REPO_ROOT / path).is_dir()]
    assert not missing, "项目结构文档声明的核心目录缺失：\n" + "\n".join(missing)


def test_delivery_docs_match_current_migration_and_three_workshops() -> None:
    from db.migrations.registry import LATEST_MIGRATION_ID

    handoff = (REPO_ROOT / "docs" / "architecture" / "handoff-readiness.md").read_text(
        encoding="utf-8"
    )
    layout = (REPO_ROOT / "docs" / "architecture" / "project-layout.md").read_text(encoding="utf-8")
    guide = (WEB_SRC / "docs" / "content.ts").read_text(encoding="utf-8")
    assert LATEST_MIGRATION_ID in handoff
    assert "双工坊" not in layout + guide
    assert all(workshop in guide for workshop in ("视觉创作工坊", "Galgame 工坊", "视频剪辑工坊"))
    assert all(
        (REPO_ROOT / "web" / "public" / "docs" / filename).is_file()
        for filename in ("video-editor-projects.jpg", "video-editor-timeline.jpg")
    )


def test_documentation_markdown_and_compatibility_sources_are_present() -> None:
    docs_root = WEB_SRC / "docs"
    assert len(list((docs_root / "articles").rglob("*.md"))) >= 105
    assert (docs_root / "legacyLinks.json").is_file()
    content = (docs_root / "content.ts").read_text(encoding="utf-8")
    assert "import.meta.glob" in content
    assert "architecture,operations,reference" not in content
    assert "../../../docs/reference/api.md" in content
    assert "developer-documents" in (docs_root / "DocsApp.tsx").read_text(encoding="utf-8")
    assert not (docs_root / "videoEditorContent.ts").exists()
    assert (REPO_ROOT / "web/public/docs/sources.json").is_file()


def test_galgame_protocol_and_schema_modules_stay_split() -> None:
    route_root = BACKEND_APP / "apps" / "galgame_workshop" / "routes"
    assert {"projects.py", "story.py", "assets.py", "asr.py", "maintenance.py"}.issubset(
        {path.name for path in route_root.glob("*.py")}
    )
    assert not (BACKEND_APP / "routes" / "galgame_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_workshop.py").exists()
    assert not (BACKEND_APP / "routes" / "galgame_workshop").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_workshop").exists()


def test_project_applications_have_modules_routes_and_storage_roots() -> None:
    registry = (WEB_SRC / "app" / "applicationRegistry.ts").read_text(encoding="utf-8")
    settings = (BACKEND_APP / "runtime" / "config.py").read_text(encoding="utf-8")
    storage = (BACKEND_APP / "capabilities" / "asset_store" / "storage.py").read_text(
        encoding="utf-8"
    )
    for application in ("visual-workshop", "galgame-workshop", "video-editor"):
        feature = WEB_SRC / "features" / application
        module = feature / "module.ts"
        assert module.is_file(), f"{application} 缺少 feature module"
        source = module.read_text(encoding="utf-8")
        assert "supportsProjects: true" in source
        assert f"/apps/{application}/projects/" in source
        assert f'"{application}"' in settings + storage
        assert module.stem in registry or application.replace("-", "_").upper() in registry


def test_library_backed_applications_have_modules_and_routes() -> None:
    """Apps that reuse the shared file library still need a module and public URL."""
    registry = (WEB_SRC / "app" / "applicationRegistry.ts").read_text(encoding="utf-8")
    tools_catalog = (WEB_SRC / "features" / "tools" / "catalog.ts").read_text(encoding="utf-8")
    for application, export_name in (
        ("presentation-workshop", "PRESENTATION_WORKSHOP_MODULE"),
        ("audio-annotation", "AUDIO_ANNOTATION_MODULE"),
    ):
        feature = WEB_SRC / "features" / application
        module = feature / "module.ts"
        assert module.is_file(), f"{application} 缺少 feature module"
        source = module.read_text(encoding="utf-8")
        assert "supportsProjects: true" in source
        assert f"/apps/{application}" in source
        assert export_name in registry
    assert 'id: "audio-annotation"' not in tools_catalog


def test_source_files_stay_under_the_review_soft_limit() -> None:
    generated_root = WEB_SRC / "generated"
    oversized: list[str] = []
    for root in (
        BACKEND_APP,
        WEB_SRC,
        REPO_ROOT / "scripts/website",
    ):
        for path in sorted(root.rglob("*")):
            if (
                not path.is_file()
                or path.suffix not in SOURCE_SOFT_LIMITS
                or _is_within(path, generated_root)
            ):
                continue
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            limit = SOURCE_SOFT_LIMITS[path.suffix]
            if line_count > limit:
                oversized.append(f"{_relative(path)}: {line_count} > {limit}")
    assert not oversized, (
        "单文件超过可评审软上限，请按语义拆分而不是按行数机械切片：\n" + "\n".join(oversized)
    )


def test_test_files_stay_under_the_review_soft_limit() -> None:
    roots = (REPO_ROOT / "tests", REPO_ROOT / "web" / "tests", REPO_ROOT / "web" / "e2e")
    oversized: list[str] = []
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.suffix not in {".py", ".ts", ".tsx"}:
                continue
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            if line_count > TEST_SOFT_LIMIT:
                oversized.append(f"{_relative(path)}: {line_count} > {TEST_SOFT_LIMIT}")
    assert not oversized, "测试文件超过可评审软上限，请按被测行为拆分：\n" + "\n".join(oversized)


def test_restructured_directories_stay_within_the_line_budget() -> None:
    """One directory level must stay reviewable, so bulk goes into named subdomains."""
    oversized: list[str] = []
    for directory in _restructured_directories():
        total = sum(
            len(path.read_text(encoding="utf-8").splitlines())
            for path in directory.iterdir()
            if path.is_file() and path.suffix in SOURCE_SOFT_LIMITS
        )
        if total > DIRECTORY_LINE_BUDGET:
            oversized.append(f"{_relative(directory)}: {total} > {DIRECTORY_LINE_BUDGET}")
    assert not oversized, (
        "目录直接持有的行数超预算，请再分出命名子域而不是继续平铺：\n" + "\n".join(oversized)
    )


def test_restructured_files_use_semantic_names() -> None:
    violations = [
        _relative(path)
        for directory in _restructured_directories()
        for path in sorted(directory.iterdir())
        if path.is_file()
        and path.suffix in SOURCE_SOFT_LIMITS
        and MECHANICAL_SHARD_PATTERN.search(path.stem)
    ]
    assert not violations, "文件名不得使用机械分片后缀，请按它承担的职责命名：\n" + "\n".join(
        violations
    )


def test_restructured_styles_have_no_empty_shell_barrels() -> None:
    violations: list[str] = []
    for directory in _restructured_directories():
        for path in sorted(directory.glob("*.css")):
            lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
            body = [line for line in lines if line and not line.startswith("/*")]
            if body and len(body) < 10 and all(line.startswith("@import") for line in body):
                violations.append(_relative(path))
    assert not violations, (
        "样式不得只做转发的空壳 barrel，请让引用方直接导入真实样式：\n" + "\n".join(violations)
    )


def test_apps_only_cross_each_other_through_declared_handoffs() -> None:
    """An app that silently imports another app cannot be deleted on its own."""
    violations: list[str] = []
    for app in WEB_APP_UNITS:
        for path in sorted((WEB_SRC / "features" / app).rglob("*")):
            if path.suffix not in {".ts", ".tsx"}:
                continue
            for specifier in _web_imports(path):
                matched = re.match(r"@features/([^/]+)", specifier)
                if matched is None:
                    continue
                target = matched.group(1)
                if target == app or target not in WEB_APP_UNITS:
                    continue
                if (app, target) in ALLOWED_APP_HANDOFFS and specifier == f"@features/{target}":
                    continue
                violations.append(f"{_relative(path)} imports {specifier}")
    assert not violations, "App 之间只能通过已登记的交接用例并经公共入口互相依赖：\n" + "\n".join(
        violations
    )


def test_css_uses_semantic_source_files_and_read_only_bundle_budgets() -> None:
    numbered = sorted(
        _relative(path)
        for path in WEB_SRC.rglob("*.css")
        if re.fullmatch(r"part-\d+\.css", path.name)
    )
    assert not numbered, "不得新增编号式 CSS 分片：\n" + "\n".join(numbered)
    budget_script = (REPO_ROOT / "web" / "scripts" / "check-bundle-budgets.mjs").read_text(
        encoding="utf-8"
    )
    assert "writeFileSync" not in budget_script
    assert "unlinkSync" not in budget_script
