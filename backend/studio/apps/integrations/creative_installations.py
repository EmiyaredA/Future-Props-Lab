"""Install one authorized published Creative batch using owned transactions and receipts."""

import hashlib
import hmac
import json
import shutil
import time
from collections.abc import Awaitable, Callable, Mapping
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.integrations.models import (
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from app.integrations.schemas import McpCreateIn, ToolApiCreateIn
from app.integrations.skills.archive import SkillArchiveStorage
from app.runtime.credentials import SecretCipher
from studio.apps.integrations.storage.creative_records import (
    CreativeInstallCancellation,
    CreativeInstalledPart,
    CreativeInstallReceipt,
)
from studio.contracts.asset_library.incoming import IncomingFile
from studio.contracts.creative_workshop.creative_integrations import (
    CreativeInstallBatch,
    CreativeOperationGrant,
    CreativeStdioConfiguration,
)
from studio.contracts.creative_workshop.creative_integrations import (
    part_fingerprint as fingerprint,
)
from studio.contracts.integrations.integration_intents import digest
from studio.runtime.files.skill_tree import skill_tree_sha256
from studio.runtime.ids import new_id

Authorize = Callable[[], Awaitable[CreativeOperationGrant]]


class CountingInput:
    def __init__(self, source: IncomingFile, maximum: int):
        self.source, self.maximum, self.count = source, maximum, 0
        self.filename, self.content_type = "creative-skill.zip", "application/zip"

    async def read(self, size=-1):
        chunk = await self.source.read(size)
        self.count += len(chunk)
        if self.count > self.maximum:
            raise HTTPException(413, "creative_skill_archive_too_large")
        return chunk

    async def close(self):
        await self.source.close()


def conflict(code):
    return HTTPException(409, {"code": code, "message": "安装请求与已有记录冲突"})


def validate_grant(grant, *, purpose, operation, fingerprint_value, owner=None):
    now = int(time.time())
    if (
        not isinstance(grant, CreativeOperationGrant)
        or not isinstance(grant.owner_user_id, str)
        or not 1 <= len(grant.owner_user_id) <= 100
        or grant.purpose != purpose
        or grant.operation_id != operation
        or grant.fingerprint != fingerprint_value
        or (owner is not None and grant.owner_user_id != owner)
        or type(grant.expires_at) is not int
        or grant.expires_at <= now
        or grant.expires_at > now + 10
    ):
        raise HTTPException(403, "creative_install_authorization_invalid")
    return grant.owner_user_id


SENSITIVE_KEYS = (
    "authorization",
    "api_key",
    "apikey",
    "access_key",
    "accesskey",
    "token",
    "secret",
    "password",
    "bearer",
    "credential",
    "private_key",
)


def reject_private_configuration(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if any(word in str(key).lower() for word in SENSITIVE_KEYS):
                raise HTTPException(422, "creative_install_private_manifest")
            reject_private_configuration(child)
    elif isinstance(value, list):
        for child in value:
            reject_private_configuration(child)
    elif isinstance(value, str) and ("Bearer " in value or "-----BEGIN " in value):
        raise HTTPException(422, "creative_install_private_manifest")


def safe_manifest(part):
    manifest = part.manifest
    reject_private_configuration(manifest)
    allowed = {
        "tool_api": {
            "method",
            "url",
            "auth_kind",
            "auth_header_name",
            "parameters_schema",
            "query_template",
            "body_template",
        },
        "mcp": {"transport", "url", "command_hint"},
        "skill": {"name", "description", "content_sha256", "file_count", "expanded_bytes"},
    }[part.kind]
    if set(manifest) - allowed:
        raise HTTPException(422, "creative_install_manifest_invalid")
    if part.kind in {"tool_api", "mcp"} and manifest.get("transport") != "stdio":
        url = manifest.get("url", "")
        if not isinstance(url, str):
            raise HTTPException(422, "creative_install_manifest_invalid")
        parsed = urlsplit(url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise HTTPException(422, "creative_install_private_url")
    if part.kind == "tool_api":
        try:
            return ToolApiCreateIn.model_validate(
                {
                    **manifest,
                    "name": part.target_name,
                    "description": part.summary,
                    "tags": part.tags,
                    "enabled": False,
                }
            )
        except ValidationError:
            raise HTTPException(422, "creative_install_manifest_invalid") from None
    if part.kind == "mcp":
        if manifest.get("transport") not in {"stdio", "streamable_http"}:
            raise HTTPException(422, "creative_install_manifest_invalid")
        if manifest.get("transport") == "stdio":
            hint = manifest.get("command_hint", "")
            if (
                not isinstance(hint, str)
                or not hint
                or len(hint) > 200
                or "/" in hint
                or "\\" in hint
            ):
                raise HTTPException(422, "creative_install_manifest_invalid")
            return None
        try:
            return McpCreateIn.model_validate(
                {
                    "name": part.target_name,
                    "description": part.summary,
                    "transport": "streamable_http",
                    "url": manifest.get("url", ""),
                    "tags": part.tags,
                    "enabled": False,
                }
            )
        except ValidationError:
            raise HTTPException(422, "creative_install_manifest_invalid") from None
    return None


class CreativeInstallations:
    def __init__(self, database, settings):
        self.database, self.settings = database, settings
        self.cipher = SecretCipher(settings.fpl_secrets_key)

    async def require_part_resource(self, session, owner, result):
        kind, state, resource_id = (
            result.get("kind"),
            result.get("state"),
            result.get("resource_id"),
        )
        models = {"tool_api": ToolApiIntegration, "mcp": McpIntegration, "skill": SkillIntegration}
        if kind not in models:
            raise conflict("creative_install_receipt_invalid")
        if state == "pending_setup" and kind == "mcp" and not resource_id:
            return
        if state != "disabled" or not resource_id:
            raise conflict("creative_install_receipt_invalid")
        row = await session.get(models[kind], resource_id)
        if row is None or row.owner_user_id != owner:
            raise conflict("creative_installed_resource_deleted")

    async def require_receipt_resources(self, session, owner, result):
        for item in result.get("resources", []):
            part = await session.scalar(
                select(CreativeInstalledPart).where(
                    CreativeInstalledPart.owner_user_id == owner,
                    CreativeInstalledPart.release_id == item.get("release_id"),
                )
            )
            if part is None:
                raise conflict("creative_install_receipt_invalid")
            await self.require_part_resource(session, owner, part.result)

    async def prior(self, owner, operation):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            return await session.scalar(
                select(CreativeInstallReceipt).where(
                    CreativeInstallReceipt.owner_user_id == owner,
                    CreativeInstallReceipt.operation_id == operation,
                )
            )

    async def preview(self, batch: CreativeInstallBatch, authorize: Authorize):
        checksum = digest(batch.model_dump(mode="json"))
        first = await authorize()
        owner = validate_grant(
            first, purpose="preview", operation=batch.operation_id, fingerprint_value=checksum
        )
        for part in batch.parts:
            safe_manifest(part)
        models = {"tool_api": ToolApiIntegration, "mcp": McpIntegration, "skill": SkillIntegration}
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            existing = {
                row.release_id: row
                for row in await session.scalars(
                    select(CreativeInstalledPart).where(
                        CreativeInstalledPart.owner_user_id == owner,
                        CreativeInstalledPart.release_id.in_(
                            [part.release_id for part in batch.parts]
                        ),
                    )
                )
            }
            names = {
                kind: {
                    name.casefold()
                    for name in await session.scalars(
                        select(model.name).where(model.owner_user_id == owner)
                    )
                }
                for kind, model in models.items()
            }
            parts = []
            requested = set()
            for part in batch.parts:
                prior = existing.get(part.release_id)
                if prior and prior.fingerprint != fingerprint(part):
                    raise conflict("creative_release_changed")
                if prior:
                    await self.require_part_resource(session, owner, prior.result)
                folded = part.target_name.casefold()
                name = part.kind, folded
                conflict_found = name in requested or (prior is None and folded in names[part.kind])
                requested.add(name)
                parts.append(
                    {
                        "release_id": part.release_id,
                        "target_name": part.target_name,
                        "conflict": conflict_found,
                        "already_installed": prior is not None,
                    }
                )
        current = await authorize()
        validate_grant(
            current,
            purpose="preview",
            operation=batch.operation_id,
            fingerprint_value=checksum,
            owner=owner,
        )
        return {"parts": parts, "installable": not any(item["conflict"] for item in parts)}

    async def receipt(self, batch: CreativeInstallBatch, authorize: Authorize):
        checksum = digest(batch.model_dump(mode="json"))
        decision = await authorize()
        owner = validate_grant(
            decision, purpose="receipt", operation=batch.operation_id, fingerprint_value=checksum
        )
        previous = await self.prior(owner, batch.operation_id)
        validate_grant(
            decision,
            purpose="receipt",
            operation=batch.operation_id,
            fingerprint_value=checksum,
            owner=owner,
        )
        if previous is None:
            return None
        if previous.fingerprint != checksum:
            raise conflict("creative_install_operation_conflict")
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await self.require_receipt_resources(session, owner, previous.result)
        validate_grant(
            decision,
            purpose="receipt",
            operation=batch.operation_id,
            fingerprint_value=checksum,
            owner=owner,
        )
        return dict(previous.result)

    async def cancel(self, batch: CreativeInstallBatch, authorize: Authorize):
        """Atomically prohibit future installation or return the already committed receipt."""
        checksum = digest(batch.model_dump(mode="json"))
        decision = await authorize()
        owner = validate_grant(
            decision, purpose="cancel", operation=batch.operation_id, fingerprint_value=checksum
        )
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            validate_grant(
                decision,
                purpose="cancel",
                operation=batch.operation_id,
                fingerprint_value=checksum,
                owner=owner,
            )
            prior = await session.scalar(
                select(CreativeInstallReceipt).where(
                    CreativeInstallReceipt.owner_user_id == owner,
                    CreativeInstallReceipt.operation_id == batch.operation_id,
                )
            )
            if prior is not None:
                if prior.fingerprint != checksum:
                    raise conflict("creative_install_operation_conflict")
                await self.require_receipt_resources(session, owner, prior.result)
                validate_grant(
                    decision,
                    purpose="cancel",
                    operation=batch.operation_id,
                    fingerprint_value=checksum,
                    owner=owner,
                )
                return {"state": "committed", "receipt": dict(prior.result)}
            cancelled = await session.scalar(
                select(CreativeInstallCancellation).where(
                    CreativeInstallCancellation.owner_user_id == owner,
                    CreativeInstallCancellation.operation_id == batch.operation_id,
                )
            )
            if cancelled is not None and cancelled.fingerprint != checksum:
                raise conflict("creative_install_operation_conflict")
            if cancelled is None:
                session.add(
                    CreativeInstallCancellation(
                        id=new_id(),
                        owner_user_id=owner,
                        operation_id=batch.operation_id,
                        fingerprint=checksum,
                    )
                )
                await session.flush()
            validate_grant(
                decision,
                purpose="cancel",
                operation=batch.operation_id,
                fingerprint_value=checksum,
                owner=owner,
            )
            await session.commit()
            return {
                "state": "cancelled",
                "operation_id": batch.operation_id,
                "fingerprint": checksum,
            }

    async def install(
        self,
        batch: CreativeInstallBatch,
        archives: Mapping[str, IncomingFile],
        authorize: Authorize,
    ):
        checksum = digest(batch.model_dump(mode="json"))
        first = await authorize()
        owner = validate_grant(
            first, purpose="install", operation=batch.operation_id, fingerprint_value=checksum
        )
        prior = await self.prior(owner, batch.operation_id)
        if prior is not None:
            validate_grant(
                first,
                purpose="install",
                operation=batch.operation_id,
                fingerprint_value=checksum,
                owner=owner,
            )
            if prior.fingerprint != checksum:
                raise conflict("creative_install_operation_conflict")
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await self.require_receipt_resources(session, owner, prior.result)
            validate_grant(
                first,
                purpose="install",
                operation=batch.operation_id,
                fingerprint_value=checksum,
                owner=owner,
            )
            return dict(prior.result)
        # Avoid unpacking a cancelled upload; the writer transaction rechecks
        # this tombstone because cancellation may race the staging work.
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            cancelled = await session.scalar(
                select(CreativeInstallCancellation).where(
                    CreativeInstallCancellation.owner_user_id == owner,
                    CreativeInstallCancellation.operation_id == batch.operation_id,
                )
            )
            if cancelled is not None:
                raise conflict("creative_install_cancelled")
        kinds = {part.release_id for part in batch.parts if part.kind == "skill"}
        if set(archives) - kinds:
            raise HTTPException(422, "creative_install_archive_mismatch")
        checked = {part.release_id: safe_manifest(part) for part in batch.parts}
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            old = set(
                await session.scalars(
                    select(CreativeInstalledPart.release_id).where(
                        CreativeInstalledPart.owner_user_id == owner,
                        CreativeInstalledPart.release_id.in_(
                            [part.release_id for part in batch.parts]
                        ),
                    )
                )
            )
        storage = SkillArchiveStorage(self.settings, owner)
        staged, placed = {}, []
        commit_started = False
        try:
            for part in batch.parts:
                if part.kind != "skill" or part.release_id in old:
                    continue
                if part.release_id not in archives:
                    raise HTTPException(422, "creative_skill_archive_required")
                descriptor = part.skill
                if descriptor.byte_size > self.settings.fpl_skill_archive_max_bytes:
                    raise HTTPException(413, "creative_skill_archive_too_large")
                source = CountingInput(archives[part.release_id], descriptor.byte_size)
                value = await storage.stage(source)
                staged[part.release_id] = value
                if (
                    source.count != descriptor.byte_size
                    or value.sha256 != descriptor.sha256
                    or value.file_count != descriptor.file_count
                    or value.expanded_bytes != descriptor.expanded_bytes
                    or skill_tree_sha256(
                        value.directory,
                        max_files=self.settings.fpl_skill_max_files,
                        max_bytes=self.settings.fpl_skill_expanded_max_bytes,
                    )
                    != descriptor.tree_sha256
                ):
                    raise HTTPException(422, "creative_skill_archive_mismatch")
            decision = await authorize()
            validate_grant(
                decision,
                purpose="install",
                operation=batch.operation_id,
                fingerprint_value=checksum,
                owner=owner,
            )
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                if int(time.time()) >= decision.expires_at:
                    raise HTTPException(403, "creative_install_authorization_expired")
                cancelled = await session.scalar(
                    select(CreativeInstallCancellation).where(
                        CreativeInstallCancellation.owner_user_id == owner,
                        CreativeInstallCancellation.operation_id == batch.operation_id,
                    )
                )
                if cancelled is not None:
                    raise conflict("creative_install_cancelled")
                previous = await session.scalar(
                    select(CreativeInstallReceipt).where(
                        CreativeInstallReceipt.owner_user_id == owner,
                        CreativeInstallReceipt.operation_id == batch.operation_id,
                    )
                )
                if previous:
                    if previous.fingerprint != checksum:
                        raise conflict("creative_install_operation_conflict")
                    await self.require_receipt_resources(session, owner, previous.result)
                    if int(time.time()) >= decision.expires_at:
                        raise HTTPException(403, "creative_install_authorization_expired")
                    return dict(previous.result)
                models = {
                    "tool_api": ToolApiIntegration,
                    "mcp": McpIntegration,
                    "skill": SkillIntegration,
                }
                names = {}
                for kind, model in models.items():
                    names[kind] = {
                        name.casefold()
                        for name in await session.scalars(
                            select(model.name).where(model.owner_user_id == owner)
                        )
                    }
                resources = []
                for part in batch.parts:
                    prior_part = await session.scalar(
                        select(CreativeInstalledPart).where(
                            CreativeInstalledPart.owner_user_id == owner,
                            CreativeInstalledPart.release_id == part.release_id,
                        )
                    )
                    part_digest = fingerprint(part)
                    if prior_part:
                        if prior_part.fingerprint != part_digest:
                            raise conflict("creative_release_changed")
                        await self.require_part_resource(session, owner, prior_part.result)
                        resources.append(dict(prior_part.result))
                        continue
                    folded = part.target_name.casefold()
                    if folded in names[part.kind]:
                        raise conflict("creative_install_name_conflict")
                    names[part.kind].add(folded)
                    resource_id, state = new_id(), "disabled"
                    value = checked[part.release_id]
                    if part.kind == "tool_api":
                        session.add(
                            ToolApiIntegration(
                                id=resource_id,
                                owner_user_id=owner,
                                name=value.name,
                                description=value.description,
                                method=value.method,
                                url=value.url,
                                auth_kind=value.auth_kind,
                                auth_header_name=value.auth_header_name,
                                secret_ciphertext="",
                                parameters_schema=value.parameters_schema,
                                query_template=value.query_template,
                                body_template=value.body_template,
                                tags=value.tags,
                                enabled=False,
                                status="unchecked",
                            )
                        )
                    elif part.kind == "mcp" and value is None:
                        resource_id, state = "", "pending_setup"
                    elif part.kind == "mcp":
                        session.add(
                            McpIntegration(
                                id=resource_id,
                                owner_user_id=owner,
                                name=value.name,
                                description=value.description,
                                transport="streamable_http",
                                url=value.url,
                                bearer_ciphertext="",
                                environment_ciphertext="",
                                tags=value.tags,
                                enabled=False,
                                status="unchecked",
                            )
                        )
                    else:
                        archive = staged.get(part.release_id)
                        if archive is None:
                            raise HTTPException(409, "creative_skill_archive_retry_required")
                        target = storage.root / resource_id / "v1"
                        if target.parent.is_symlink() or target.is_symlink():
                            raise HTTPException(409, "creative_skill_path_invalid")
                        target.parent.mkdir(parents=True, exist_ok=False)
                        if target.parent.resolve() != target.parent:
                            raise HTTPException(409, "creative_skill_path_invalid")
                        placed.append(target.parent)
                        archive.directory.rename(target)
                        session.add(
                            SkillIntegration(
                                id=resource_id,
                                owner_user_id=owner,
                                name=part.target_name,
                                description=part.summary,
                                default_version="v1",
                                latest_version="v1",
                                tags=part.tags,
                                enabled=False,
                                status="healthy",
                            )
                        )
                        session.add(
                            SkillVersion(
                                skill_id=resource_id,
                                version="v1",
                                name=archive.name,
                                description=archive.description,
                                storage_path=str(target),
                                content_sha256=archive.sha256,
                                file_count=archive.file_count,
                                expanded_bytes=archive.expanded_bytes,
                            )
                        )
                    result = {
                        "release_id": part.release_id,
                        "kind": part.kind,
                        "name": part.target_name,
                        "resource_id": resource_id,
                        "state": state,
                    }
                    resources.append(result)
                    session.add(
                        CreativeInstalledPart(
                            id=new_id(),
                            owner_user_id=owner,
                            release_id=part.release_id,
                            fingerprint=part_digest,
                            description=part.summary,
                            result=result,
                        )
                    )
                result = {
                    "operation_id": batch.operation_id,
                    "root_release_id": batch.root_release_id,
                    "resources": resources,
                }
                session.add(
                    CreativeInstallReceipt(
                        id=new_id(),
                        owner_user_id=owner,
                        operation_id=batch.operation_id,
                        fingerprint=checksum,
                        result=result,
                    )
                )
                if int(time.time()) >= decision.expires_at:
                    raise HTTPException(403, "creative_install_authorization_expired")
                await session.flush()
                if int(time.time()) >= decision.expires_at:
                    raise HTTPException(403, "creative_install_authorization_expired")
                commit_started = True
                await session.commit()
                return result
        except IntegrityError:
            raise conflict("creative_install_name_conflict") from None
        finally:
            for value in staged.values():
                shutil.rmtree(value.directory, ignore_errors=True)
            if not commit_started:
                for path in placed:
                    shutil.rmtree(path, ignore_errors=True)

    async def configure_stdio(self, body: CreativeStdioConfiguration, authorize: Authorize):
        payload = body.model_dump(mode="json")
        checksum = digest(payload)
        decision = await authorize()
        owner = validate_grant(
            decision, purpose="setup", operation=body.release_id, fingerprint_value=checksum
        )
        # Store a keyed fingerprint, not command environment or an offline-verifiable hash.
        mac = hmac.new(
            self.settings.fpl_secrets_key.encode(), checksum.encode(), hashlib.sha256
        ).hexdigest()
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.scalar(
                select(CreativeInstalledPart).where(
                    CreativeInstalledPart.owner_user_id == owner,
                    CreativeInstalledPart.release_id == body.release_id,
                )
            )
            if int(time.time()) >= decision.expires_at:
                raise HTTPException(403, "creative_install_authorization_expired")
            if row is None or row.result.get("kind") != "mcp":
                raise HTTPException(404, "creative_setup_not_found")
            if row.setup_fingerprint:
                if not hmac.compare_digest(row.setup_fingerprint, mac):
                    raise conflict("creative_setup_operation_conflict")
                await self.require_part_resource(session, owner, row.result)
                if int(time.time()) >= decision.expires_at:
                    raise HTTPException(403, "creative_install_authorization_expired")
                return dict(row.result)
            if row.result.get("state") != "pending_setup":
                raise conflict("creative_setup_not_pending")
            if int(time.time()) >= decision.expires_at:
                raise HTTPException(403, "creative_install_authorization_expired")
            try:
                checked = McpCreateIn(
                    name=row.result["name"],
                    description=row.description,
                    transport="stdio",
                    command=body.command,
                    arguments=body.arguments,
                    environment=body.environment,
                    enabled=False,
                )
            except ValidationError:
                raise HTTPException(422, "creative_stdio_configuration_invalid") from None
            existing = [
                name
                for name in await session.scalars(
                    select(McpIntegration.name).where(McpIntegration.owner_user_id == owner)
                )
            ]
            if checked.name.casefold() in {name.casefold() for name in existing}:
                raise conflict("creative_install_name_conflict")
            resource_id = new_id()
            session.add(
                McpIntegration(
                    id=resource_id,
                    owner_user_id=owner,
                    name=checked.name,
                    description=checked.description,
                    transport="stdio",
                    command=checked.command,
                    arguments=checked.arguments,
                    environment_ciphertext=self.cipher.encrypt(
                        json.dumps(checked.environment, ensure_ascii=False)
                    )
                    if checked.environment
                    else "",
                    environment_keys=list(checked.environment),
                    enabled=False,
                    status="unchecked",
                )
            )
            row.result = {**row.result, "resource_id": resource_id, "state": "disabled"}
            row.setup_fingerprint = mac
            if int(time.time()) >= decision.expires_at:
                raise HTTPException(403, "creative_install_authorization_expired")
            try:
                await session.flush()
                if int(time.time()) >= decision.expires_at:
                    raise HTTPException(403, "creative_install_authorization_expired")
                await session.commit()
            except IntegrityError:
                raise conflict("creative_install_name_conflict") from None
            return dict(row.result)
