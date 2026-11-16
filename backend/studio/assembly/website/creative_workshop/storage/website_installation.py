from __future__ import annotations

import json
import shutil

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.creative_workshop.storage.catalog_files import resolve_file
from studio.apps.creative_workshop.storage.models import CreativeInstallation, CreativeRelease
from studio.apps.integrations.skills.archive import SkillArchiveStorage
from studio.apps.integrations.storage.models import (
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from studio.contracts.creative_workshop.catalog import (
    CreativeInstallOut,
    CreativeInstallPartOut,
    CreativeInstallPreviewIn,
    CreativeInstallPreviewOut,
    CreativeStdioSetupIn,
)
from studio.contracts.creative_workshop.errors import CreativeError
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.integrations.catalog import McpCreateIn
from studio.runtime.ids import new_id


class LegacyCreativeInstaller:
    def __init__(
        self, session: AsyncSession, principal: StudioPrincipal, *, catalog, settings, cipher
    ) -> None:
        self.settings, self.cipher = settings, cipher
        self.session = session
        self.principal = principal
        self.catalog = catalog

    def _authorize(self) -> None:
        if not self.principal.allows("configuration.manage"):
            raise CreativeError("需要当前账号的集成管理权限", 403, "permission_denied")

    async def _existing(self, release_id: str) -> CreativeInstallation | None:
        return await self.session.scalar(
            select(CreativeInstallation).where(
                CreativeInstallation.owner_user_id == self.principal.owner_user_id,
                CreativeInstallation.release_id == release_id,
            )
        )

    async def _parts(self, release_id: str) -> list[tuple[object, CreativeRelease]]:
        item, release = await self.catalog.resolve_installable_release(release_id)
        if item.kind != "bundle":
            return [(item, release)]
        if not release.components:
            raise CreativeError("方案包没有能力，无法安装")
        parts = [
            await self.catalog.resolve_installable_release(part_id)
            for part_id in release.components
        ]
        if any(part.kind == "bundle" for part, _ in parts):
            raise CreativeError("方案包不能包含方案包")
        return parts

    async def preview(self, body: CreativeInstallPreviewIn) -> CreativeInstallPreviewOut:
        self._authorize()
        parts = await self._parts(body.release_id)
        result: list[CreativeInstallPartOut] = []
        requested: set[tuple[str, str]] = set()
        for item, release in parts:
            already = await self._existing(release.id)
            name = body.names.get(release.id, release.title).strip()
            if not 1 <= len(name) <= 120:
                raise CreativeError("目标名称须为 1 至 120 个字符")
            model = {
                "tool_api": ToolApiIntegration,
                "mcp": McpIntegration,
                "skill": SkillIntegration,
            }[item.kind]
            conflict = (item.kind, name.casefold()) in requested
            requested.add((item.kind, name.casefold()))
            if not already:
                match = await self.session.scalar(
                    select(model.id).where(
                        model.owner_user_id == self.principal.owner_user_id,
                        func.lower(model.name) == name.casefold(),
                    )
                )
                conflict = conflict or match is not None
            result.append(
                CreativeInstallPartOut(
                    release_id=release.id,
                    kind=item.kind,
                    title=release.title,
                    target_name=name,
                    conflict=conflict,
                    already_installed=already is not None,
                    pending_setup=item.kind == "mcp"
                    and release.manifest.get("transport") == "stdio",
                )
            )
        return CreativeInstallPreviewOut(
            release_id=body.release_id,
            parts=result,
            installable=not any(part.conflict for part in result),
        )

    async def install(self, body: CreativeInstallPreviewIn) -> CreativeInstallOut:
        self._authorize()
        previous = await self._existing(body.release_id)
        if previous:
            return CreativeInstallOut(
                id=previous.id,
                release_id=body.release_id,
                resources=previous.resources,
                already_installed=True,
            )
        preview = await self.preview(body)
        if not preview.installable:
            raise CreativeError("目标账号有名称冲突，请调整名称后重试", 409, "name_conflict")
        parts = await self._parts(body.release_id)
        copied: list[object] = []
        resources: list[dict] = []
        try:
            for (item, release), part in zip(parts, preview.parts, strict=True):
                prior = await self._existing(release.id)
                if prior:
                    resources.extend(prior.resources)
                    continue
                manifest = release.manifest
                resource_id = new_id()
                if item.kind == "tool_api":
                    self.session.add(
                        ToolApiIntegration(
                            id=resource_id,
                            owner_user_id=self.principal.owner_user_id,
                            name=part.target_name,
                            description=release.summary,
                            method=manifest["method"],
                            url=manifest["url"],
                            auth_kind=manifest.get("auth_kind", "none"),
                            auth_header_name=manifest.get("auth_header_name", ""),
                            secret_ciphertext="",
                            parameters_schema=manifest.get("parameters_schema", {}),
                            query_template=manifest.get("query_template", {}),
                            body_template=manifest.get("body_template"),
                            tags=release.tags,
                            enabled=False,
                            status="unchecked",
                        )
                    )
                    state = "disabled"
                elif item.kind == "mcp" and manifest["transport"] == "streamable_http":
                    self.session.add(
                        McpIntegration(
                            id=resource_id,
                            owner_user_id=self.principal.owner_user_id,
                            name=part.target_name,
                            description=release.summary,
                            transport="streamable_http",
                            url=manifest["url"],
                            bearer_ciphertext="",
                            environment_ciphertext="",
                            tags=release.tags,
                            enabled=False,
                            status="unchecked",
                        )
                    )
                    state = "disabled"
                elif item.kind == "mcp":
                    resource_id = ""
                    state = "pending_setup"
                else:
                    source = resolve_file(
                        item.origin_owner_user_id, release.skill_path, settings=self.settings
                    )
                    if not (source / "SKILL.md").is_file():
                        raise CreativeError(
                            "Skill 发布文件不可用，安装已取消", 409, "missing_skill_file"
                        )
                    target = SkillArchiveStorage(
                        self.settings, self.principal.owner_user_id
                    ).final_path(resource_id, "v1")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    copied.append(target.parent)
                    shutil.copytree(source, target)
                    self.session.add(
                        SkillIntegration(
                            id=resource_id,
                            owner_user_id=self.principal.owner_user_id,
                            name=part.target_name,
                            description=release.summary,
                            default_version="v1",
                            latest_version="v1",
                            tags=release.tags,
                            enabled=False,
                            status="healthy",
                        )
                    )
                    self.session.add(
                        SkillVersion(
                            skill_id=resource_id,
                            version="v1",
                            name=manifest.get("name", release.title),
                            description=manifest.get("description", release.summary),
                            storage_path=str(target),
                            content_sha256=manifest["content_sha256"],
                            file_count=manifest["file_count"],
                            expanded_bytes=manifest["expanded_bytes"],
                        )
                    )
                    state = "disabled"
                entry = {
                    "release_id": release.id,
                    "kind": item.kind,
                    "name": part.target_name,
                    "resource_id": resource_id,
                    "state": state,
                }
                resources.append(entry)
                if release.id != body.release_id:
                    self.session.add(
                        CreativeInstallation(
                            owner_user_id=self.principal.owner_user_id,
                            release_id=release.id,
                            installed_by_user_id=self.principal.user_id,
                            resources=[entry],
                        )
                    )
            record = CreativeInstallation(
                owner_user_id=self.principal.owner_user_id,
                release_id=body.release_id,
                installed_by_user_id=self.principal.user_id,
                resources=resources,
            )
            self.session.add(record)
            await self.session.commit()
            return CreativeInstallOut(id=record.id, release_id=body.release_id, resources=resources)
        except Exception as exc:
            await self.session.rollback()
            for path in copied:
                shutil.rmtree(path, ignore_errors=True)
            if isinstance(exc, IntegrityError):
                raise CreativeError(
                    "目标账号配置发生冲突，请重新预检", 409, "name_conflict"
                ) from exc
            raise

    async def configure_stdio(
        self, installation_id: str, body: CreativeStdioSetupIn
    ) -> CreativeInstallOut:
        self._authorize()
        record = await self.session.get(CreativeInstallation, installation_id)
        if record is None or record.owner_user_id != self.principal.owner_user_id:
            raise CreativeError("安装记录不存在", 404, "not_found")
        entries = list(record.resources or [])
        index = next(
            (
                index
                for index, entry in enumerate(entries)
                if entry.get("release_id") == body.release_id
                and entry.get("state") == "pending_setup"
            ),
            None,
        )
        if index is None:
            raise CreativeError("没有待配置的 stdio MCP", 409, "not_pending")
        release = await self.session.get(CreativeRelease, body.release_id)
        if release is None:
            raise CreativeError("能力版本不存在", 404, "not_found")
        if release.manifest.get("transport") != "stdio":
            raise CreativeError("该版本不是 stdio MCP")
        entry = dict(entries[index])
        try:
            checked = McpCreateIn(
                name=entry["name"],
                description=release.summary,
                transport="stdio",
                command=body.command,
                arguments=body.arguments,
                environment=body.environment,
                enabled=False,
            )
        except ValueError as exc:
            raise CreativeError(str(exc)) from exc
        conflict = await self.session.scalar(
            select(McpIntegration.id).where(
                McpIntegration.owner_user_id == self.principal.owner_user_id,
                func.lower(McpIntegration.name) == entry["name"].casefold(),
            )
        )
        if conflict:
            raise CreativeError("目标账号已有同名 MCP", 409, "name_conflict")
        resource_id = new_id()
        self.session.add(
            McpIntegration(
                id=resource_id,
                owner_user_id=self.principal.owner_user_id,
                name=checked.name,
                description=checked.description,
                transport="stdio",
                command=checked.command,
                arguments=checked.arguments,
                environment_ciphertext=self.cipher.encrypt(json.dumps(checked.environment))
                if checked.environment
                else "",
                environment_keys=list(checked.environment),
                enabled=False,
                status="unchecked",
            )
        )
        entry.update({"resource_id": resource_id, "state": "disabled"})
        records = (
            (
                await self.session.execute(
                    select(CreativeInstallation).where(
                        CreativeInstallation.owner_user_id == self.principal.owner_user_id
                    )
                )
            )
            .scalars()
            .all()
        )
        for current in records:
            current.resources = [
                entry
                if part.get("release_id") == body.release_id
                and part.get("state") == "pending_setup"
                else part
                for part in current.resources
            ]
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise CreativeError("目标账号已有同名 MCP", 409, "name_conflict") from exc
        return CreativeInstallOut(
            id=record.id, release_id=record.release_id, resources=record.resources
        )
