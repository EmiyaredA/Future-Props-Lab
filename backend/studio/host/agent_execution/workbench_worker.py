"""Mac-side workbench directory discovery from a dedicated credential."""

import argparse
import asyncio
import logging
import os
import stat
from dataclasses import asdict
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException
from pydantic import TypeAdapter

from studio.apps.agent_workbench.execution import project_files, projects
from studio.apps.agent_workbench.execution.project_paths import validate_project_root
from studio.apps.agent_workbench.execution.schemas import (
    AgentChoice,
    ExecutionCatalog,
    ProjectChoice,
    RecentProject,
)
from studio.config import read_config
from studio.config.settings import Settings
from studio.contracts.agent_workbench.execution import (
    CATALOG,
    CHECK_PROJECT,
    DIRECTORIES,
    PREVIEW_SOURCE,
    REGISTER,
    DirectoryQuery,
    Discovery,
    HistoryFile,
    ProjectCheck,
    ProjectFile,
    ProjectReady,
    RegisterProject,
)
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.integrations.integration_intents import digest
from studio.host.agent_execution.cli.catalog import (
    DEFINITIONS,
    connection,
    execution_signature,
    inspect_connection,
)
from studio.host.agent_execution.cli.dialogue import run_dialogue
from studio.host.receipts import ReceiptStore
from studio.host.transport import LeaseEnded, NativeTransport, ProtocolConflict
from studio.host.workbench_turn import MacTurn
from studio.runtime.lifecycle.locking import service_lock

logger = logging.getLogger(__name__)
PREVIEW_SCOPE = TypeAdapter(ProjectFile | HistoryFile)


class WorkbenchConfiguration:
    def __init__(self, config, agent_root, protected_root):
        self.config = config
        self.agent_root = agent_root.resolve(strict=True)
        self.protected_root = protected_root.resolve(strict=True)
        if not self.agent_root.is_dir() or not self.protected_root.is_dir():
            raise ValueError("工作台需要实际的保护目录和 Agent 档案目录")
        self.settings_key = Fernet.generate_key().decode("ascii")

    def settings(self, *, for_agents=False):
        values = {
            key: value
            for key, value in read_config(self.config).items()
            if key == "fpl_cloud_control_projects" or key.startswith("fpl_code_agents_")
        }
        root = self.agent_root if for_agents else self.protected_root
        return Settings(
            _config_file=None,
            _read_environment=False,
            fpl_database_path=str(root / "settings-only.db"),
            fpl_secrets_key=self.settings_key,
            **values,
        )


class WorkbenchWorker:
    def __init__(
        self,
        transport,
        configuration,
        state_root,
        *,
        inspect=inspect_connection,
        locate=connection,
        dialogue=run_dialogue,
    ):
        self.transport, self.configuration, self.inspect = transport, configuration, inspect
        self.locate, self.dialogue = locate, dialogue
        self.file_writes = asyncio.Lock()
        self.turn_receipts = ReceiptStore(
            state_root / "turn-receipts",
            retain_acknowledged_payload=False,
        )
        self.receipts = ReceiptStore(
            state_root / "receipts",
            readonly_operations={CATALOG, CHECK_PROJECT, DIRECTORIES, REGISTER},
            retain_acknowledged_payload=False,
        )

    async def authorize(self, lease):
        result = await self.transport.post(
            "execution/authorize", {"lease": lease.model_dump(mode="json")}
        )
        if result.get("active") is not True:
            raise LeaseEnded("工作台原生授权已结束")

    async def execute(self, lease):
        try:
            await self.authorize(lease)
            if lease.operation == CATALOG:
                result = await self.catalog(
                    lease.owner_user_id, Discovery.model_validate(lease.payload)
                )
            elif lease.operation == CHECK_PROJECT:
                scope = ProjectCheck.model_validate(lease.payload)
                result = (await self.check_project(lease.owner_user_id, scope)).model_dump(
                    mode="json"
                )
            elif lease.operation == PREVIEW_SOURCE:
                scope = PREVIEW_SCOPE.validate_python(lease.payload)
                result = await self.preview_file(lease.owner_user_id, scope)
            elif lease.operation == DIRECTORIES:
                body = DirectoryQuery.model_validate(lease.payload)
                settings = await asyncio.to_thread(self.configuration.settings)
                result = (
                    await asyncio.to_thread(projects.browse, body.parent, settings)
                ).model_dump(mode="json")
            elif lease.operation == REGISTER:
                body = RegisterProject.model_validate(lease.payload)
                settings = await asyncio.to_thread(self.configuration.settings)
                result = {
                    "root": str(await asyncio.to_thread(validate_project_root, body.root, settings))
                }
            else:
                raise ProtocolConflict("工作台租约超出目录发现范围")
            await self.authorize(lease)
            return NativeOutcome(status="completed", result=result)
        except LeaseEnded:
            return NativeOutcome(status="failed", error_code="workbench_authority_revoked")
        except HTTPException as exc:
            if isinstance(exc.detail, dict):
                code, message = exc.detail["code"], exc.detail["message"]
            else:
                code = "project_not_found" if exc.status_code == 404 else "project_unavailable"
                message = str(exc.detail)
            return NativeOutcome(status="failed", error_code=code, message=message)

    async def check_project(self, owner, scope):
        return (await self.resolve_project(owner, scope))[-1]

    async def bind_project(self, owner, scope):
        settings = await asyncio.to_thread(self.configuration.settings)
        if scope.registered_root is not None:
            if not scope.local:
                raise HTTPException(403, "公网入口不得使用本机项目目录")
            project = projects.AuthorizedProject(
                scope.project_id,
                scope.registered_root,
                projects.label_for(scope.registered_root),
                source="local",
            )
        else:
            project = projects.configured_binding(scope.project_id, owner, settings)
        return await projects.check_root(project, settings)

    async def bind_history_project(self, owner, scope):
        settings = await asyncio.to_thread(self.configuration.settings)
        if scope.local and scope.registered:
            project = projects.AuthorizedProject(
                scope.root, scope.root, projects.label_for(scope.root), source="local"
            )
            return await projects.check_root(project, settings)
        for identity, configured in settings.fpl_cloud_control_projects.items():
            if configured.root == scope.root and owner in configured.user_ids:
                return await projects.check_root(
                    projects.configured_binding(identity, owner, settings), settings
                )
        raise HTTPException(
            403,
            {
                "code": "workbench_authority_revoked",
                "message": (
                    "此会话的项目尚未授权阅读。请在本机新会话中选择此项目，公网需配置项目授权。"
                ),
            },
        )

    async def preview_file(self, owner, scope):
        bind = self.bind_history_project if isinstance(scope, HistoryFile) else self.bind_project
        project = await bind(owner, scope)
        try:
            content = await asyncio.to_thread(
                project_files.read_file,
                project.root,
                scope.path,
                expected_root=project.directory_key,
            )
        except (OSError, ValueError):
            content = None
        if content is None:
            raise HTTPException(
                404, {"code": "source_not_found", "message": "文件已移除或无法预览"}
            )
        if await bind(owner, scope) != project:
            raise HTTPException(409, {"code": "project_unavailable", "message": "工作台项目已变更"})
        return {"path": scope.path, "text": content}

    async def resolve_project(self, owner, scope, *, probe=True):
        project = await self.bind_project(owner, scope)
        runtime = await asyncio.to_thread(self.configuration.settings, for_agents=True)
        if probe:
            agent = await self.inspect(runtime, scope.agent, discover_models=False)
            enabled, executable = agent["available"], agent.get("executable")
        else:
            enabled, executable, message = await asyncio.to_thread(
                self.locate, runtime, scope.agent
            )
            enabled = enabled and not message
        if not enabled or not executable:
            raise HTTPException(409, {"code": "agent_unavailable", "message": "Agent 连接不可用"})
        signature = ProjectReady(
            project_id=project.identity,
            label=project.label,
            agent_signature=execution_signature(scope.agent, executable),
            project_signature=digest(asdict(project)),
        )
        return project, executable, runtime.runtime_path, signature

    async def catalog(self, owner, body):
        settings = await asyncio.to_thread(self.configuration.settings)
        runtime = await asyncio.to_thread(self.configuration.settings, for_agents=True)

        def directories():
            configured = [
                ProjectChoice(id=identity, label=project.label)
                for identity, project in settings.fpl_cloud_control_projects.items()
                if owner in project.user_ids and projects.valid_root(project.root, settings)
            ]
            recent = [
                RecentProject(id=item.id, root=item.root, label=projects.label_for(item.root))
                for item in body.recent
                if body.local and projects.valid_root(item.root, settings)
            ]
            suggestions = projects.suggestions(settings) if body.local else []
            return configured, recent, suggestions

        configured, recent, suggestions = await asyncio.to_thread(directories)
        statuses = await asyncio.gather(
            *(self.inspect(runtime, agent, discover_models=False) for agent in DEFINITIONS)
        )
        choices = [
            AgentChoice(
                id=agent,
                label=definition.name,
                available=status["available"],
                status=status["message"],
            )
            for (agent, definition), status in zip(DEFINITIONS.items(), statuses, strict=True)
            if status["enabled"]
        ]
        return ExecutionCatalog(
            enabled=True,
            projects=configured,
            agents=choices,
            can_select_directory=body.local,
            recent_projects=recent,
            suggested_directories=suggestions,
        ).model_dump(mode="json")

    async def deliver(self, lease, outcome):
        result = await self.transport.post(
            "execution/receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if result.get("acknowledged") is not True:
            raise ProtocolConflict("工作台执行回执未确认")
        if lease.operation != PREVIEW_SOURCE:
            await asyncio.to_thread(self.receipts.acknowledge, lease)

    async def poll_once(self):
        for lease, stored in self.receipts.pending():
            outcome = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await self.receipts.execute_async(lease, self.execute)
            )
            await self.deliver(lease, outcome)
        reply = await self.transport.post("execution/claim", {"wait_seconds": 1})
        if reply.get("lease") is not None:
            lease = NativeLease.model_validate(reply["lease"])
            outcome = (
                await self.execute(lease)
                if lease.operation == PREVIEW_SOURCE
                else await self.receipts.execute_async(lease, self.execute)
            )
            await self.deliver(lease, outcome)

    async def execute_turn(self, lease):
        return await MacTurn(self, lease).run()

    async def deliver_turn(self, lease, outcome):
        result = await self.transport.post(
            "execution/turns/receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if result.get("acknowledged") is not True:
            raise ProtocolConflict("工作台轮次回执未确认")
        await asyncio.to_thread(self.turn_receipts.acknowledge, lease)

    async def poll_turn(self):
        for lease, stored in self.turn_receipts.pending():
            outcome = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await self.turn_receipts.execute_async(lease, self.execute_turn)
            )
            await self.deliver_turn(lease, outcome)
        reply = await self.transport.post("execution/turns/claim", {"wait_seconds": 1})
        if reply.get("lease") is not None:
            lease = NativeLease.model_validate(reply["lease"])
            await self.deliver_turn(
                lease, await self.turn_receipts.execute_async(lease, self.execute_turn)
            )

    async def poll(self, operation):
        while True:
            try:
                await operation()
            except (httpx.HTTPError, OSError, ValueError, LeaseEnded, ProtocolConflict):
                logger.warning("工作台原生通道暂不可用，保留回执")
                await asyncio.sleep(2)

    async def run(self):
        try:
            async with asyncio.TaskGroup() as tasks:
                tasks.create_task(self.poll(self.poll_once))
                tasks.create_task(self.poll(self.poll_turn))
        finally:
            await self.transport.close()


def main():
    parser = argparse.ArgumentParser(description="FPL Mac Workbench execution worker")
    parser.add_argument("--bridge", required=True)
    parser.add_argument("--worker-token", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--agent-state-root", required=True, type=Path)
    parser.add_argument("--protected-state-root", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    args = parser.parse_args()
    for path in (args.config, args.worker_token):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            parser.error("执行器配置和凭据必须为当前用户独占普通文件")
    config = WorkbenchConfiguration(args.config, args.agent_state_root, args.protected_state_root)
    transport = NativeTransport(
        service="agents", base_url=args.bridge, credential=args.worker_token.read_text().strip()
    )
    with service_lock(args.state_root):
        asyncio.run(WorkbenchWorker(transport, config, args.state_root).run())


if __name__ == "__main__":
    main()
