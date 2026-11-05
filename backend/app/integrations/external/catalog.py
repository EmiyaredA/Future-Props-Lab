from __future__ import annotations

import httpx
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.runtime.config import get_settings
from app.runtime.credentials import SecretCipher
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now

from .contracts import ConnectionCredentials, ExternalError, document_target
from .feishu import FeishuClient
from .models import ExternalConnection
from .schemas import ExternalConnectionList, ExternalConnectionOut, ExternalTargetOut


def connection_out(row) -> ExternalConnectionOut:
    return ExternalConnectionOut(
        id=row.id,
        provider=row.provider,
        name=row.name,
        app_id=row.app_id,
        has_secret=bool(row.secret_ciphertext),
        enabled=row.enabled,
        status=row.status,
        status_message=row.status_message,
        last_checked_at=iso_utc(row.last_checked_at) if row.last_checked_at else None,
        revision=row.revision,
    )


class ExternalConnections:
    def __init__(self, session, owner_user_id, transport=None, *, cipher=None):
        self.cipher = cipher or SecretCipher(get_settings().fpl_secrets_key)
        self.session, self.owner_user_id, self.transport = session, owner_user_id, transport

    async def get(self, id):
        row = await self.session.scalar(
            select(ExternalConnection).where(
                ExternalConnection.id == id, ExternalConnection.owner_user_id == self.owner_user_id
            )
        )
        if row is None:
            raise ExternalError("连接不存在", 404, "not_found")
        return row

    async def list(self):
        rows = await self.session.scalars(
            select(ExternalConnection)
            .where(ExternalConnection.owner_user_id == self.owner_user_id)
            .order_by(ExternalConnection.name)
        )
        return ExternalConnectionList(items=[connection_out(r) for r in rows])

    async def save(self, body, id=None):
        row = await self.get(id) if id else None
        secret = (
            self.cipher.encrypt(body.app_secret)
            if body.app_secret
            else row.secret_ciphertext
            if row
            else ""
        )
        if not secret:
            raise ExternalError("首次配置需要填写 App Secret")
        values = dict(
            name=body.name,
            app_id=body.app_id,
            secret_ciphertext=secret,
            enabled=body.enabled,
            status="unchecked",
            status_message="",
            last_checked_at=None,
        )
        try:
            if row:
                result = await self.session.execute(
                    update(ExternalConnection)
                    .where(
                        ExternalConnection.id == row.id,
                        ExternalConnection.owner_user_id == self.owner_user_id,
                        ExternalConnection.revision == body.expected_revision,
                    )
                    .values(**values, revision=ExternalConnection.revision + 1)
                )
                if result.rowcount != 1:
                    await self.session.rollback()
                    current = connection_out(await self.get(id))
                    raise RevisionConflictError(
                        body.expected_revision, current.revision, current.model_dump(mode="json")
                    )
            else:
                row = ExternalConnection(owner_user_id=self.owner_user_id, **values)
                self.session.add(row)
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise ExternalError("连接名称已存在", 409, "duplicate_connection") from None
        await self.session.refresh(row)
        return connection_out(row)

    async def require_enabled(self, id, *, expected_revision=None):
        row = await self.get(id)
        if not row.enabled:
            raise ExternalError("连接已停用", 409, "connection_disabled")
        if expected_revision is not None and row.revision != expected_revision:
            raise ExternalError("连接配置已变化，请重新预览", 409, "connection_changed")
        return row

    async def client(self, id, *, expected_revision=None):
        row = await self.require_enabled(id, expected_revision=expected_revision)
        credentials = ConnectionCredentials(row.app_id, self.cipher.decrypt(row.secret_ciphertext))
        await self.session.rollback()
        return FeishuClient(credentials, self.transport)

    async def check(self, id):
        row = await self.get(id)
        revision = row.revision
        client = await self.client(id)
        try:
            await client.token()
            status, message = "healthy", "鉴权通过；文章绑定时还需检查目标文档权限"
        except (ExternalError, httpx.HTTPError):
            status, message = "failed", "鉴权失败，请检查 App ID、App Secret 和应用发布状态"
        result = await self.session.execute(
            update(ExternalConnection)
            .where(
                ExternalConnection.id == id,
                ExternalConnection.owner_user_id == self.owner_user_id,
                ExternalConnection.revision == revision,
            )
            .values(status=status, status_message=message, last_checked_at=utc_now())
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise ExternalError("检查期间配置发生变化，请重新检查", 409)
        await self.session.commit()
        return connection_out(await self.get(id))

    async def resolve_document(self, id, url) -> tuple[str, str]:
        parsed = document_target(url)
        if parsed.kind == "docx":
            return parsed.token, parsed.url
        client = await self.client(id)
        try:
            return await client.resolve(parsed)
        except httpx.HTTPError:
            raise ExternalError("连接飞书失败，请稍后重试", 502) from None

    async def target(self, id, url):
        parsed = document_target(url)
        client = await self.client(id)
        try:
            document_id, url = await client.resolve(parsed)
            remote = await client.read(document_id)
            writable = await client.can_write(document_id)
        except httpx.HTTPError:
            raise ExternalError("连接飞书失败，请稍后重试", 502) from None
        return ExternalTargetOut(
            document_id=document_id,
            url=url,
            title=remote.title,
            text=remote.text,
            fingerprint=remote.fingerprint,
            revision=remote.revision,
            can_write=writable,
        )
