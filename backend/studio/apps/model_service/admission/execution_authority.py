"""Accepted job inputs retain their source request; queued execution rechecks Identity."""

from time import monotonic

import jwt
from sqlalchemy import select

from app.llm.task_outcomes import TaskClaimRejected
from app.runtime.task_records import load_runner_task
from studio.apps.model_service.storage.service_models import TaskAuthorization
from studio.apps.model_service.storage.task_records import TASK_MODELS, task_fingerprint
from studio.contracts.identity.claims import Actor, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.identity.route_permissions import route_permission

CREATION_PATHS = {
    "inference": frozenset({"/v1/model-inference/tasks"}),
    "model": frozenset({"/v1/model-test/generation-tasks"}),
    "transcription": frozenset(
        {
            "/v1/model-test/transcription-tasks",
            "/v1/model-test/transcription-tasks/upload",
        }
    ),
}


class ModelTaskAuthority:
    def __init__(self, session_factory, *, public_key, catalog, identity):
        self.sessions, self.key, self.catalog, self.identity = (
            session_factory,
            public_key,
            catalog,
            identity,
        )

    def source_actor(self, *, assertion, actor, method, path, kind):
        operation = self.catalog.match(method, path)
        if (
            not isinstance(actor, Actor)
            or kind not in CREATION_PATHS
            or method != "POST"
            or operation is None
            or operation.service != "models"
            or actor.purpose != "studio"
            or "studio:write" not in actor.scopes
        ):
            raise ValueError("模型任务缺少有效来源授权")
        # SignedIdentity already checked expiry on ingress. Large accepted uploads may
        # finish later; the original signature/actor must still match exactly.
        verified = verify_context(
            assertion,
            service="models",
            method=method,
            path=path,
            public_key=self.key,
            allow_expired=True,
        )
        permission = route_permission(method, path)
        if verified != actor or permission not in effective_permissions(
            actor.platform_role, frozenset(actor.scopes)
        ):
            raise ValueError("模型任务来源身份不匹配")
        return verified

    async def retain(self, session, *, assertion, actor, method, path, kind, task_ids):
        actor = self.source_actor(
            assertion=assertion, actor=actor, method=method, path=path, kind=kind
        )
        if session.info.get("owner_user_id") != actor.user_id:
            raise ValueError("模型任务授权缺少匹配的账号上下文")
        await session.flush()
        for task_id in set(task_ids):
            model = TASK_MODELS[kind]
            task = await session.scalar(select(model).where(model.id == task_id))
            if task is None:
                raise ValueError("模型任务不存在")
            if (
                kind == "inference"
                and path == ("/v1/model-inference/tasks/" + task_id + "/retry-materialization")
                and task.status == "processing"
                and task.result_url
            ):
                # A separately authorized retry only saves the known result. It must
                # neither replace the original submission authority nor submit again.
                continue
            if path not in CREATION_PATHS[kind] or task.status != "queued":
                raise ValueError("来源操作不能授权此模型任务")
            fingerprint = task_fingerprint(kind, task)
            prior = await session.get(TaskAuthorization, (kind, task_id))
            if prior is not None:
                original = verify_context(
                    prior.assertion,
                    service="models",
                    method=prior.source_method,
                    path=prior.source_path,
                    public_key=self.key,
                    allow_expired=True,
                )
                if (
                    prior.fingerprint != fingerprint
                    or original != actor
                    or prior.source_method != method
                    or prior.source_path != path
                ):
                    raise ValueError("模型任务不能更换原始授权或输入")
                continue
            session.add(
                TaskAuthorization(
                    kind=kind,
                    task_id=task_id,
                    owner_user_id=actor.user_id,
                    fingerprint=fingerprint,
                    source_method=method,
                    source_path=path,
                    assertion=assertion,
                )
            )
        await session.flush()

    async def prepare(self, kind, task_id):
        """Returns a short-lived local claim check; no network runs in its transaction."""
        if kind not in CREATION_PATHS:
            raise ValueError("任务不属于 Models 服务")
        async with self.sessions() as session:
            task = await load_runner_task(session, TASK_MODELS[kind], task_id, subject="模型任务")
            if task is None:
                return None
            owner = task.owner_user_id
            if task.status != "queued":

                async def settlement_only(_session, current):
                    return current.status != "queued"

                return settlement_only
            record = await session.get(TaskAuthorization, (kind, task_id))
            fingerprint = task_fingerprint(kind, task)
            invalid = record is None or record.fingerprint != fingerprint
            if not invalid:
                try:
                    original = verify_context(
                        record.assertion,
                        service="models",
                        method=record.source_method,
                        path=record.source_path,
                        public_key=self.key,
                        allow_expired=True,
                    )
                    self.source_actor(
                        assertion=record.assertion,
                        actor=original,
                        method=record.source_method,
                        path=record.source_path,
                        kind=kind,
                    )
                    invalid = (
                        original.user_id != owner or record.source_path not in CREATION_PATHS[kind]
                    )
                except (jwt.InvalidTokenError, ValueError, TypeError):
                    invalid = True
            source = (
                None if invalid else (record.assertion, record.source_method, record.source_path)
            )
        # This await must remain outside every database/session context.
        active = (
            False
            if source is None
            else await self.identity.status(assertion=source[0], method=source[1], path=source[2])
        )
        if active is None:
            return None
        expires = monotonic() + 5

        async def authorized_claim(session, current):
            if (
                session.info.get("owner_user_id") != owner
                or current.owner_user_id != owner
                or current.id != task_id
                or task_fingerprint(kind, current) != fingerprint
            ):
                raise TaskClaimRejected("模型任务输入或归属与提交授权不一致，未提交供应商")
            if monotonic() >= expires:
                return False
            if active is not True:
                raise TaskClaimRejected("模型任务的账号或提交授权已失效，未提交供应商")
            return True

        return authorized_claim
