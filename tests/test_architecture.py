from __future__ import annotations

import ast
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_APP = REPO_ROOT / "backend" / "app"
WEB_SRC = REPO_ROOT / "web" / "src"
SIZE_BASELINE = json.loads(
    (REPO_ROOT / "tests" / "architecture_size_baseline.json").read_text(encoding="utf-8")
)

FORBIDDEN_BACKEND_DIRECTORIES = {"domain", "platform", "product", "services"}
ROUTE_FORBIDDEN_IMPORTS = ("app.core.db", "app.models", "db", "sqlalchemy")
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put", "trace", "websocket"}
ROOT_PROBE_PATHS = {"/health", "/ready"}

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
    from app.core.tenant_context import TENANT_MODELS
    from app.models import (
        Base,
        ManagementApiKey,
        SecurityAuditEvent,
        WorkspaceInvitation,
        WorkspaceMembership,
    )

    account_governance_models = {
        ManagementApiKey,
        SecurityAuditEvent,
        WorkspaceInvitation,
        WorkspaceMembership,
    }
    workspace_models = {
        mapper.class_ for mapper in Base.registry.mappers if hasattr(mapper.class_, "workspace_id")
    }
    missing = workspace_models - set(TENANT_MODELS) - account_governance_models
    assert not missing, "带 workspace_id 的业务模型必须注册租户过滤：" + ", ".join(
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
            '"model-test-tools"',
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
    }
    allowed_route_metadata = {WEB_SRC / "features" / "visual-workshop" / "module.ts"}
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
    for path in _python_files(BACKEND_APP / "routes"):
        for module in _python_imports(path):
            if any(_matches_module(module, prefix) for prefix in ROUTE_FORBIDDEN_IMPORTS):
                violations.append(f"{_relative(path)} imports {module}")
    assert not violations, "路由层不得直接依赖持久化实现：\n" + "\n".join(violations)


def test_business_modules_do_not_depend_on_fastapi_upload_file() -> None:
    violations: list[str] = []
    route_root = BACKEND_APP / "routes"
    for path in _python_files(BACKEND_APP):
        if path.is_relative_to(route_root):
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
    source = (BACKEND_APP / "core" / "tenant_context.py").read_text(encoding="utf-8")
    assert "ContextVar" not in source
    assert "current_workspace_id" not in source


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


def test_backend_avoids_generic_abstract_layer_directories() -> None:
    violations = sorted(
        _relative(path)
        for path in BACKEND_APP.rglob("*")
        if path.is_dir() and path.name in FORBIDDEN_BACKEND_DIRECTORIES
    )
    assert not violations, "请按具体能力命名后端目录：\n" + "\n".join(violations)


def test_agent_harness_is_provider_independent() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for path in _python_files(BACKEND_APP / "agents" / "harness")
        for module in _python_imports(path)
        if _matches_module(module, "app.llm.providers")
    ]
    assert not violations, "Agent Harness 不得依赖具体供应商：\n" + "\n".join(violations)


def test_transcription_consumers_do_not_depend_on_playground() -> None:
    violations = [
        f"{_relative(path)} imports {module}"
        for root in (
            BACKEND_APP / "audio_annotation",
            BACKEND_APP / "galgame_workshop",
        )
        for path in _python_files(root)
        for module in _python_imports(path)
        if _matches_module(module, "app.llm.playground")
    ]
    assert not violations, "语音能力消费者不得依赖模型测试实现：\n" + "\n".join(violations)


def test_account_service_does_not_own_catalog_provisioning() -> None:
    imports = _python_imports(BACKEND_APP / "accounts" / "service.py")
    assert not any(_matches_module(module, "app.llm") for module in imports)
    assert (BACKEND_APP / "accounts" / "provisioning.py").is_file()


def test_public_files_have_independent_ownership() -> None:
    required = (
        BACKEND_APP / "files" / "assets.py",
        BACKEND_APP / "models" / "files.py",
        BACKEND_APP / "schemas" / "files.py",
    )
    assert all(path.is_file() for path in required), "公共文件能力必须由 app/files 拥有"
    assert not (BACKEND_APP / "visual_workshop" / "assets.py").exists()
    for route_name in ("file_management.py", "visual_workshop.py"):
        imports = _python_imports(BACKEND_APP / "routes" / route_name)
        assert "app.visual_workshop.assets" not in imports


def test_visual_assistant_has_no_function_local_app_imports() -> None:
    violations: list[str] = []
    for path in _python_files(BACKEND_APP / "visual_workshop" / "assistant"):
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
    allowed_roots = {"routes", "schemas", "models", "core", "concurrency", "files"}
    violations: list[str] = []
    for path in _python_files(BACKEND_APP):
        relative = path.relative_to(BACKEND_APP)
        if relative.parts[0] in allowed_roots:
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
        BACKEND_APP / "core" / "config.py",
        BACKEND_APP / "files" / "storage.py",
        BACKEND_APP / "files" / "layout_migration.py",
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
            for specifier in _web_imports(path)
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
    assert not cycles, "TypeScript 生产模块不得形成导入循环：\n" + "\n".join(
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
    routes_init = BACKEND_APP / "routes" / "__init__.py"
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
        "backend/app/agents",
        "backend/app/concurrency",
        "backend/app/core",
        "backend/app/files",
        "backend/app/llm",
        "backend/app/models",
        "backend/app/routes",
        "backend/app/schemas",
        "backend/app/galgame_workshop",
        "backend/app/tool_navigation",
        "backend/app/visual_workshop",
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


def test_galgame_protocol_and_schema_modules_stay_split() -> None:
    route_root = BACKEND_APP / "routes" / "galgame_workshop"
    assert {"projects.py", "story.py", "assets.py", "asr.py", "maintenance.py"}.issubset(
        {path.name for path in route_root.glob("*.py")}
    )
    assert not (BACKEND_APP / "routes" / "galgame_workshop.py").exists()
    assert not (BACKEND_APP / "schemas" / "galgame_workshop.py").exists()


def test_project_applications_have_modules_routes_and_storage_roots() -> None:
    registry = (WEB_SRC / "app" / "applicationRegistry.ts").read_text(encoding="utf-8")
    settings = (BACKEND_APP / "core" / "config.py").read_text(encoding="utf-8")
    storage = (BACKEND_APP / "files" / "storage.py").read_text(encoding="utf-8")
    for application in ("visual-workshop", "galgame-workshop", "video-editor"):
        feature = WEB_SRC / "features" / application
        module = feature / "module.ts"
        assert module.is_file(), f"{application} 缺少 feature module"
        source = module.read_text(encoding="utf-8")
        assert "supportsProjects: true" in source
        assert f"/apps/{application}/projects/" in source
        assert f'"{application}"' in settings + storage
        assert module.stem in registry or application.replace("-", "_").upper() in registry


def test_source_modules_are_split_into_reviewable_files() -> None:
    generated_root = WEB_SRC / "generated"
    limits = {
        ".py": 700,
        ".ts": 800,
        ".tsx": 800,
        ".css": 600,
    }
    oversized: list[str] = []
    for root in (BACKEND_APP, WEB_SRC):
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in limits or _is_within(path, generated_root):
                continue
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            limit = limits[path.suffix]
            if line_count <= limit:
                continue
            relative = _relative(path)
            baseline = SIZE_BASELINE["production"].get(relative)
            if baseline is None or line_count > baseline:
                oversized.append(f"{relative}: {line_count} > {limit}")
    assert not oversized, "生产源码超过硬上限，既有基线文件也不得继续增长：\n" + "\n".join(
        oversized
    )


def test_test_modules_are_split_into_reviewable_files() -> None:
    roots = (REPO_ROOT / "tests", REPO_ROOT / "web" / "tests", REPO_ROOT / "web" / "e2e")
    oversized: list[str] = []
    for root in roots:
        for path in sorted(root.rglob("*")):
            if path.suffix not in {".py", ".ts", ".tsx"}:
                continue
            line_count = len(path.read_text(encoding="utf-8").splitlines())
            if line_count <= 1_200:
                continue
            relative = _relative(path)
            baseline = SIZE_BASELINE["tests"].get(relative)
            if baseline is None or line_count > baseline:
                oversized.append(f"{relative}: {line_count} > 1200")
    assert not oversized, "测试文件超过硬上限，既有基线文件也不得继续增长：\n" + "\n".join(
        oversized
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
