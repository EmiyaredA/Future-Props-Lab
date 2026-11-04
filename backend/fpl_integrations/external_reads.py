"""Connection credentials and Feishu reads stay within the Integrations owner boundary."""

import asyncio

from app.integrations.external.catalog import ExternalConnections
from app.integrations.external.contracts import ExternalError


async def guarded(operation, check):
    await check()

    async def watch():
        while True:
            await asyncio.sleep(1)
            await check()

    task, watcher = asyncio.create_task(operation()), asyncio.create_task(watch())
    try:
        done, _ = await asyncio.wait({task, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            await watcher
            raise ExternalError("同步授权暂不可用", 503, "authorization_unavailable")
        result = await task
        await check()
        return result
    finally:
        for pending in (task, watcher):
            pending.cancel()
        await asyncio.gather(task, watcher, return_exceptions=True)


class ExternalReads:
    def __init__(self, database, transport=None, *, cipher=None):
        self.cipher = cipher
        self.database, self.transport = database, transport

    async def execute(self, owner, connection_id, body, check, *, scope=None):
        await check()
        if scope is not None:
            if connection_id != scope.connection_id or body.connection_revision not in {
                None,
                scope.connection_revision,
            }:
                raise ExternalError("同步连接范围不一致", 403, "scope_mismatch")
            if body.op not in {"get", "require_enabled", "read", "can_write"}:
                raise ExternalError("后台同步不能重新解析目标", 403, "scope_mismatch")
            if body.op in {"read", "can_write"} and body.document_id != scope.document_id:
                raise ExternalError("同步文档范围不一致", 403, "scope_mismatch")
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            connections = ExternalConnections(session, owner, self.transport, cipher=self.cipher)
            if body.op in {"get", "require_enabled"}:
                row = await (
                    connections.get(connection_id)
                    if body.op == "get"
                    else connections.require_enabled(
                        connection_id,
                        expected_revision=body.connection_revision
                        if scope is None
                        else scope.connection_revision,
                    )
                )
                return {"id": row.id, "revision": row.revision, "enabled": row.enabled}
            revision = body.connection_revision if scope is None else scope.connection_revision
            await connections.require_enabled(connection_id, expected_revision=revision)
            if body.op == "resolve_document":
                result = await guarded(
                    lambda: connections.resolve_document(connection_id, body.url), check
                )
                return {"document_id": result[0], "url": result[1]}
            if body.op in {"target", "binding_target"}:
                result = await guarded(lambda: connections.target(connection_id, body.url), check)
                fields = (
                    {"document_id", "title", "can_write"} if body.op == "binding_target" else None
                )
                return result.model_dump(mode="json", include=fields)
            client = await connections.client(connection_id, expected_revision=revision)
        if body.op == "read":
            return (await guarded(lambda: client.read(body.document_id), check)).snapshot()
        if body.op == "can_write":
            return {"can_write": await guarded(lambda: client.can_write(body.document_id), check)}
        raise ExternalError("未知同步读取操作", 422)
