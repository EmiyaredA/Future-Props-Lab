"""Architecture gates for components already migrated to Studio."""

import ast
import subprocess
import sys
from importlib.util import resolve_name
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUDIO = ROOT / "backend/studio"


def test_interview_file_scope_is_explicit():
    files = STUDIO / "apps/interview_assistant/files.py"
    rooms = STUDIO / "apps/interview_assistant/rooms.py"
    assert "get_settings" not in files.read_text()
    assert "session.info" not in rooms.read_text()
    for node in ast.walk(ast.parse(files.read_text())):
        if isinstance(node, ast.FunctionDef) and node.name in {"room_root", "material_path"}:
            index = [arg.arg for arg in node.args.kwonlyargs].index("state_root")
            assert node.args.kw_defaults[index] is None


def test_models_never_select_process_global_configuration():
    violations = []
    for path in (STUDIO / "apps/model_service").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Name) and node.id == "get_settings":
                violations.append(str(path.relative_to(ROOT)))
            if isinstance(node, ast.Attribute) and node.attr == "get_settings":
                violations.append(str(path.relative_to(ROOT)))
    assert not violations, violations


def imports(path, *, include_types=True):
    module = ".".join(path.relative_to(ROOT / "backend").with_suffix("").parts)
    package = (
        module.removesuffix(".__init__")
        if path.name == "__init__.py"
        else module.rpartition(".")[0]
    )
    tree = ast.parse(path.read_text())
    if not include_types:

        class RuntimeImports(ast.NodeTransformer):
            def visit_If(self, node):
                if isinstance(node.test, ast.Name) and node.test.id == "TYPE_CHECKING":
                    return None
                return self.generic_visit(node)

        tree = RuntimeImports().visit(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported = (
                resolve_name("." * node.level + (node.module or ""), package)
                if node.level
                else node.module or ""
            )
            if imported != module.removesuffix(".__init__"):
                yield imported
            for alias in node.names:
                candidate = imported + "." + alias.name
                location = ROOT / "backend" / candidate.replace(".", "/")
                if location.with_suffix(".py").is_file() or (location / "__init__.py").is_file():
                    yield candidate


def test_studio_pure_components_do_not_load_adapters():
    forbidden = (
        "app",
        "fpl_",
        "fastapi",
        "starlette",
        "sqlalchemy",
        "httpx",
        "studio.assembly",
        "studio.host",
    )
    violations = []
    for path in STUDIO.rglob("*.py"):
        parts = path.relative_to(STUDIO).parts
        pure = parts[0] in {"contracts", "config"}
        pure |= parts[0] == "runtime" and len(parts) == 2
        pure |= "rules" in path.parts or "use_cases" in path.parts
        pure |= path.name == "ports.py"
        if not pure:
            continue
        for module in imports(path):
            foreign_implementation = parts[0] in {
                "contracts",
                "config",
                "runtime",
            } and module.startswith("studio.apps.")
            if (
                foreign_implementation
                or module.startswith(forbidden)
                or any(
                    part in module.split(".")
                    for part in ("storage", "clients", "transport", "routes")
                )
            ):
                violations.append(f"{path.relative_to(ROOT)} imports {module}")
    assert not violations, "\n".join(violations)


def test_studio_components_do_not_have_import_cycles():
    modules = {}
    for path in STUDIO.rglob("*.py"):
        name = ".".join(path.relative_to(ROOT / "backend").with_suffix("").parts)
        modules[name.removesuffix(".__init__")] = path
    graph = {
        name: set(imports(path, include_types=False)) & modules.keys()
        for name, path in modules.items()
    }
    visited = set()
    active = []

    def visit(name):
        assert name not in active, " -> ".join([*active, name])
        if name in visited:
            return
        active.append(name)
        for dependency in sorted(graph[name]):
            visit(dependency)
        active.pop()
        visited.add(name)

    for name in sorted(graph):
        visit(name)


def test_studio_namespace_initializers_do_not_import_applications():
    roots = [STUDIO, STUDIO / "apps", STUDIO / "contracts", STUDIO / "assembly"]
    for directory in roots:
        path = directory / "__init__.py"
        assert path.is_file()
        assert not list(imports(path)), f"{path} eagerly loads other components"


def test_migrated_packages_have_one_source_owner():
    assert not (STUDIO / "apps/agent_workbench/events.py").exists()
    assert not (STUDIO / "apps/agent_workbench/execution/events.py").exists()
    assert not (STUDIO / "apps/agent_workbench/change_stream.py").exists()
    assert (STUDIO / "config/__init__.py").is_file()
    assert (STUDIO / "apps/audio_annotation/use_cases/edit_document.py").is_file()
    for directory in (
        ROOT / "backend/fpl_config",
        ROOT / "backend/fpl_annotation",
        ROOT / "backend/app/apps/audio_annotation",
        ROOT / "backend/app/llm",
        ROOT / "backend/app/demo_runtime",
        ROOT / "backend/app/capabilities/identity",
        ROOT / "backend/app/capabilities/asset_store",
        ROOT / "backend/app/capabilities/media_rendering",
        ROOT / "backend/app/integrations",
        ROOT / "backend/app/console/creative_workshop",
        ROOT / "backend/app/console/amadeus",
        ROOT / "backend/app/tool_navigation",
        ROOT / "backend/app/console/file_library",
        ROOT / "backend/app/console/cloud_control",
        ROOT / "backend/app/capabilities/web_access",
        ROOT / "backend/app/capabilities/agents/sessions",
        ROOT / "backend/app/capabilities/agents/harness",
    ):
        assert not list(directory.rglob("*.py")), f"stale implementation in {directory}"


def test_old_prefixed_packages_cannot_be_reintroduced():
    assert not list((ROOT / "backend").glob("fpl_*"))
    for path in (ROOT / "backend").rglob("*.py"):
        assert not any(name.startswith("fpl_") for name in imports(path)), path
    legacy = ROOT / "backend/app/apps"
    assert not [p for p in legacy.rglob("*.py") if p.parent != legacy], "stale app slice"


def test_cloud_factors_have_one_owner_and_explicit_dependencies():
    for name in (
        "backend/app/console/cloud_control/access.py",
        "backend/app/console/cloud_control/models.py",
        "backend/app/console/routes/cloud_totp.py",
    ):
        assert not (ROOT / name).exists(), name
    path = STUDIO / "apps/identity/use_cases/cloud_factors.py"
    for dependency in imports(path):
        assert not dependency.startswith(("studio.config", "studio.runtime.secrets"))
    route = STUDIO / "apps/identity/transport/website/cloud_totp.py"
    tree = ast.parse(route.read_text())
    assert not any(
        isinstance(node, ast.Name) and node.id == "SessionDep" for node in ast.walk(tree)
    )


def test_remote_preference_transport_has_no_database_dependency():
    route = STUDIO / "apps/remote_desktop/transport/desktop_http.py"
    tree = ast.parse(route.read_text())
    assert not any(
        isinstance(node, ast.Name) and node.id == "SessionDep" for node in ast.walk(tree)
    )
    for dependency in imports(route):
        assert ".storage" not in dependency and not dependency.startswith("sqlalchemy")


def test_session_collection_parent_and_history_contracts_do_not_load_adapters():
    assert not list(imports(STUDIO / "host/session_collection/__init__.py"))
    assert not (ROOT / "backend/app/capabilities/agents/activity.py").exists()
    for name in ("session_history.py", "activity.py"):
        for dependency in imports(STUDIO / "contracts/agent_workbench" / name):
            assert not dependency.startswith(("studio.host", "studio.apps", "app"))


def test_tool_loop_requires_injected_approval_lifecycle():
    directory = STUDIO / "runtime/tasks/reactive_tools"
    assert not list(imports(directory / "__init__.py"))
    for path in directory.glob("*.py"):
        tree = ast.parse(path.read_text())
        assert not any(
            isinstance(node, (ast.Assign, ast.AnnAssign)) and isinstance(node.value, ast.Call)
            for node in tree.body
        ), f"{path} creates a process object at import"


def test_runtime_mechanisms_do_not_import_application_implementations():
    for path in (STUDIO / "runtime").rglob("*.py"):
        for name in imports(path):
            assert not name.startswith(
                ("app.", "studio.apps.", "studio.assembly.", "studio.host.")
            ), f"{path.relative_to(ROOT)} imports {name}"


def test_integrations_do_not_fall_back_to_global_settings():
    for path in (STUDIO / "apps/integrations").rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = (
                    node.func.id
                    if isinstance(node.func, ast.Name)
                    else node.func.attr
                    if isinstance(node.func, ast.Attribute)
                    else ""
                )
                assert name != "get_settings", path


def test_article_sync_does_not_construct_integration_storage():
    for path in (STUDIO / "apps/thought_workshop/external_sync").glob("*.py"):
        for name in imports(path):
            if name.startswith("studio.apps.integrations."):
                assert name.startswith("studio.apps.integrations.clients."), (path, name)


def test_creative_resources_are_explicit_not_session_services():
    for path in (STUDIO / "apps/creative_workshop").rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = (
                    node.func.id
                    if isinstance(node.func, ast.Name)
                    else node.func.attr
                    if isinstance(node.func, ast.Attribute)
                    else ""
                )
                assert name != "get_settings", path
            if isinstance(node, ast.Attribute) and node.attr == "info":
                assert path.name == "file_paths.py", path


def test_public_client_parents_cannot_eagerly_load_foreign_implementations():
    from studio.deployment.images import PUBLIC_CLIENT_PARENTS

    for name in PUBLIC_CLIENT_PARENTS:
        path = ROOT / "backend" / name.replace(".", "/") / "__init__.py"
        assert not list(imports(path)), f"{name} eagerly loads an implementation"


def test_local_media_adapters_cannot_load_business_storage_or_assembly():
    from studio.deployment.media_modules import LOCAL_MEDIA_MODULES

    for name in LOCAL_MEDIA_MODULES:
        location = ROOT / "backend" / name.replace(".", "/")
        path = location.with_suffix(".py")
        if not path.is_file():
            path = location / "__init__.py"
            assert not list(imports(path)), f"{name} eagerly loads an adapter"
        for dependency in imports(path):
            if dependency.startswith("studio.apps."):
                assert dependency in LOCAL_MEDIA_MODULES, (name, dependency)
            assert not dependency.startswith(
                ("app.", "sqlalchemy", "fastapi", "studio.assembly", "studio.config", "studio.host")
            ), (name, dependency)


def test_annotation_image_keeps_entrypoint_and_excludes_legacy_adapters():
    from studio.deployment.images import source_closure

    closure = source_closure(ROOT, "annotation")
    assert "studio.assembly.independent.audio_annotation.cli" in closure
    assert "studio.apps.audio_annotation.use_cases.edit_document" in closure
    assert "studio.apps.audio_annotation.use_cases.create_project" in closure
    assert "studio.apps.audio_annotation.use_cases.delete_project" in closure
    assert "studio.apps.audio_annotation.use_cases.saved_audio" in closure
    assert "studio.apps.audio_annotation.use_cases.transcribe_segment" in closure
    assert "studio.assembly.website.annotation_transcription" not in closure
    assert "studio.apps.audio_annotation.storage.projects" in closure
    assert "studio.apps.audio_annotation.projects" not in closure
    assert "studio.apps.audio_annotation.storage.document_edits" in closure
    assert "studio" in closure
    assert "studio.assembly.website.application" not in closure
    assert "studio.assembly.website.annotation_sources" not in closure
    assert "studio.assembly.website.annotation_imports" not in closure


def test_identity_image_includes_migrated_configuration():
    from studio.deployment.images import source_closure

    assert "studio.config" in source_closure(ROOT, "identity")


def test_settings_import_does_not_read_configuration_or_load_database():
    code = """
import sys
import studio.config

def forbidden(*args, **kwargs):
    raise AssertionError("configuration read during module import")

studio.config.read_config = forbidden
import studio.config.settings
assert not any(name == 'sqlalchemy' or name.startswith('app.') for name in sys.modules)
"""
    subprocess.run([sys.executable, "-c", code], cwd=ROOT / "backend", check=True)


@pytest.mark.parametrize(
    "module",
    [
        "studio.apps.audio_annotation.models",
        "studio.apps.unknown.models",
        "studio.apps.audio_annotation.clients.unreviewed",
    ],
)
def test_service_closure_rejects_foreign_studio_storage(tmp_path, module):
    from studio.deployment.images import source_closure

    entry = tmp_path / "backend/studio/assembly/independent/identity/cli.py"
    entry.parent.mkdir(parents=True)
    entry.write_text(f"import {module}\n")
    foreign = tmp_path / "backend" / (module.replace(".", "/") + ".py")
    foreign.parent.mkdir(parents=True)
    foreign.write_text('"""Foreign storage."""\n')
    with pytest.raises(ValueError, match="越界依赖"):
        source_closure(tmp_path, "identity")


def test_module_files_do_not_shadow_packages():
    collisions = [
        str(path.relative_to(ROOT))
        for path in STUDIO.rglob("*.py")
        if path.with_suffix("").is_dir()
    ]
    assert not collisions, "Module/package name collisions: " + ", ".join(collisions)


def test_director_files_are_owned_without_asset_library_or_global_configuration():
    from studio.deployment.images import source_closure

    assert not any(
        name.startswith(("studio.apps.asset_library", "studio.apps.asset_library"))
        for name in source_closure(ROOT, "director")
    )
    for name in ("files.py", "motions.py", "projects.py", "storage/file_paths.py"):
        path = STUDIO / "apps/director_desk" / name
        assert "get_settings" not in path.read_text()


def test_asset_and_media_contracts_load_without_runtime_implementations():
    code = """
import importlib
import sys
import studio.config

def forbidden(*args, **kwargs):
    raise AssertionError("contract import read deployment configuration")

studio.config.read_config = forbidden
for name in (
    'asset_library.incoming', 'asset_library.errors', 'asset_library.files',
    'media_rendering.image_crop', 'media_rendering.video_frames',
    'media_rendering.media_info', 'media_rendering.character_document',
    'video_editor.timeline_document', 'video_editor.audio_seam_results',
    'motion_compositor.document',
):
    importlib.import_module('studio.contracts.' + name)
for name in sys.modules:
    assert not name.startswith(('app.', 'studio.apps.', 'studio.assembly.',
        'studio.host.', 'sqlalchemy', 'fastapi', 'PIL', 'httpx')), name
"""
    subprocess.run([sys.executable, "-c", code], cwd=ROOT / "backend", check=True)


def test_compatibility_settings_are_not_application_internal_models():
    assert not (ROOT / "backend/app/console/models/platform_governance.py").exists()
    assert not (ROOT / "backend/app/console/governance/settings_records.py").exists()
    assert not (ROOT / "backend/app/console/governance/platform_settings.py").exists()
    assert (STUDIO / "runtime/database/settings_models.py").is_file()
    consumers = [
        p
        for p in STUDIO.rglob("*.py")
        if "studio.runtime.database.settings_models" in p.read_text()
    ]
    assert {p.relative_to(STUDIO).as_posix() for p in consumers} == {
        "runtime/database/settings_records.py",
        "assembly/website/models.py",
        "deployment/contracts.py",
    }


def test_workbench_website_does_not_duplicate_shared_turn_records():
    path = STUDIO / "apps/agent_workbench/execution/storage.py"
    definitions = {
        node.name
        for node in ast.parse(path.read_text()).body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    shared = {
        "get_chat",
        "get_turn",
        "list_chats",
        "detail",
        "recent_turns",
        "latest_turn_version",
        "append_answer",
        "propose_approval",
        "read_approval_status",
        "settle_approval",
        "request_cancellation",
        "finish_turn",
        "interrupt_all",
    }
    assert not definitions & shared
    lifecycle = (STUDIO / "assembly/website/lifecycle.py").read_text()
    assert "await recover_owned_turns(sessions)" in lifecycle


def test_workbench_never_discovers_process_global_configuration():
    violations = []
    for path in (STUDIO / "apps/agent_workbench").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom) and node.module == "studio.config.settings":
                if any(
                    alias.name in {"get_settings", "get_cloud_settings"} for alias in node.names
                ):
                    violations.append(str(path.relative_to(STUDIO)))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr in {"get_settings", "get_cloud_settings"}:
                    violations.append(str(path.relative_to(STUDIO)))
    assert not violations


def test_production_never_loads_legacy_runtime():
    for path in (ROOT / "backend").rglob("*.py"):
        assert not any(
            name == "app.runtime" or name.startswith("app.runtime.") for name in imports(path)
        ), path
    assert not list((ROOT / "backend/app/runtime").glob("*.py"))


def test_model_runners_require_explicit_configuration():
    for name in (
        "inference/runner.py",
        "playground/generation_runner.py",
        "playground/transcription_runner.py",
    ):
        path = STUDIO / "apps/model_service" / name
        tree = ast.parse(path.read_text())
        assert not any(
            isinstance(node, ast.Name) and node.id == "get_settings" for node in ast.walk(tree)
        ), path
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "studio.config.settings":
                assert all(alias.name != "get_settings" for alias in node.names), path


def test_website_thought_writing_adapter_lives_in_assembly():
    assert not (STUDIO / "apps/thought_workshop/legacy_writing.py").exists()
    assert not (STUDIO / "apps/model_service/clients/text.py").exists()
    assert (STUDIO / "assembly/website/thought_writing.py").is_file()


def test_thought_workshop_does_not_read_global_settings():
    for path in (STUDIO / "apps/thought_workshop").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom) and node.module == "studio.config.settings":
                assert all(
                    alias.name not in {"get_settings", "get_cloud_settings"} for alias in node.names
                ), path
            if isinstance(node, ast.Call):
                name = getattr(node.func, "id", getattr(node.func, "attr", None))
                assert name not in {"get_settings", "get_cloud_settings"}, path


def test_website_page_composition_and_navigation_have_explicit_owners():
    app = ROOT / "web/src/app"
    assert not (app / "App.tsx").exists()
    assert not (app / "ReadOnlyRoutes.tsx").exists()
    for name in ("CodeAgentsRoute", "ModelServiceRoute", "PresentationWorkshopRoute"):
        assert not (app / "layout" / f"{name}.tsx").exists()
        assert (app / "routing" / f"{name}.tsx").is_file()
    composition = (app / "routing/WebsiteRoutes.tsx").read_text()
    assert "useWebsiteNavigation()" in composition
    assert "history.pushState" not in composition
    assert "history.replaceState" not in composition
    assert "popstate" not in composition
    assert (app / "routes.ts").is_file()


def test_thought_sync_operations_receive_ports_instead_of_request_or_state():
    base = STUDIO / "apps/thought_workshop/synchronization"
    for filename, operation in (
        ("sync_submit.py", "submit_task"),
        ("sync_reconcile.py", "reconcile_task"),
    ):
        tree = ast.parse((base / filename).read_text())
        function = next(
            node
            for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef) and node.name == operation
        )
        names = {arg.arg for arg in [*function.args.args, *function.args.kwonlyargs]}
        assert not names & {"request", "state"}
        assert {"artifacts", "intents"} <= names
        assert not any(
            isinstance(node, ast.Attribute) and node.attr == "info" for node in ast.walk(function)
        )
    source = (base / "sync_artifacts.py").read_text()
    assert "metadata(session" not in source
    assert "session.info" not in source


def test_visual_provider_components_do_not_discover_peers_from_application_state():
    base = STUDIO / "apps/model_service/visual"
    for filename in (
        "visual_generation_intake.py",
        "visual_generation_runner.py",
        "visual_generation_results.py",
        "visual_generation_retention.py",
        "visual_generation_preflight.py",
    ):
        tree = ast.parse((base / filename).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.arg):
                assert node.arg != "state", filename
            if isinstance(node, ast.Attribute):
                assert node.attr != "visual_generation_runner", filename
                if isinstance(node.value, ast.Name) and node.value.id == "self":
                    assert node.attr not in {"state", "intake"}, filename
    storage = STUDIO / "apps/model_service/storage/visual_generation_files.py"
    assert not any(name.startswith("studio.apps.model_service.visual") for name in imports(storage))


def test_thumbnail_decoding_has_no_global_capacity_or_duplicated_implementation():
    raster = STUDIO / "runtime/files/raster.py"
    tree = ast.parse(raster.read_text())
    for statement in tree.body:
        if isinstance(statement, (ast.Assign, ast.AnnAssign)):
            for node in ast.walk(statement):
                if isinstance(node, ast.Call):
                    assert getattr(node.func, "id", None) != "RasterPreviews"
                    assert getattr(node.func, "attr", None) != "Semaphore"
    assets = (STUDIO / "apps/asset_library/previews/thumbnails.py").read_text()
    assert "def _render" not in assets
    assert "Semaphore" not in assets
    assert not (STUDIO / "apps/identity/profile_images.py").exists()
    assert "get_settings" not in (STUDIO / "apps/identity/profile.py").read_text()
